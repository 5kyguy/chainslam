import { AppError } from "../errors.js";
import { resolveToken, tokenDecimals, fromBaseUnits, toBaseUnits } from "./tokens.js";

export interface UniswapClientConfig {
  apiKey: string;
  baseUrl: string;
  chainId: number;
  swapperAddress: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface PriceResult {
  price: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  routing: string;
  fetchedAt: Date;
}

interface QuoteRequestBody {
  type: "EXACT_INPUT";
  amount: string;
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  swapper: string;
  slippageTolerance: number;
}

interface ClassicQuote {
  amountIn?: string;
  amountOut?: string;
  [key: string]: unknown;
}

interface UniswapXOutput {
  startAmount?: string;
  endAmount?: string;
  [key: string]: unknown;
}

interface UniswapXOrderInfo {
  input?: { startAmount?: string };
  outputs?: UniswapXOutput[];
  [key: string]: unknown;
}

interface QuoteResponse {
  quote?: ClassicQuote | { orderInfo?: UniswapXOrderInfo };
  routing?: string;
  [key: string]: unknown;
}

export interface QuoteRequest {
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountHuman: number;
  swapperAddress?: string;
  slippageTolerance?: number;
}

export interface SwapQuoteResult {
  raw: QuoteResponse;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  amountOut: string;
  amountInHuman: number;
  amountOutHuman: number;
  routing: string;
}

export interface KeeperCompatibleContractCall {
  contractAddress: string;
  functionName: string;
  functionArgs: unknown[];
  abi: unknown[];
  value?: string;
}

export interface SwapBuildResult {
  raw: Record<string, unknown>;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  spender?: string;
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
  };
  contractCall?: KeeperCompatibleContractCall;
}

export interface ApprovalCheckResult {
  raw: Record<string, unknown>;
  approvalNeeded: boolean;
  spender?: string;
  amount?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAmounts(data: QuoteResponse, requestedAmount: string): { amountIn: string; amountOut: string } | null {
  const quote = data.quote;
  if (!quote || typeof quote !== "object") return null;

  if ("amountIn" in quote && "amountOut" in quote) {
    return {
      amountIn: String((quote as ClassicQuote).amountIn),
      amountOut: String((quote as ClassicQuote).amountOut),
    };
  }

  if ("orderInfo" in quote) {
    const orderInfo = (quote as { orderInfo?: UniswapXOrderInfo }).orderInfo;
    if (orderInfo?.input?.startAmount && orderInfo?.outputs?.[0]) {
      const outAmount = orderInfo.outputs[0].startAmount ?? orderInfo.outputs[0].endAmount;
      if (outAmount) {
        return { amountIn: orderInfo.input.startAmount, amountOut: String(outAmount) };
      }
    }
  }

  return null;
}

export class UniswapClient {
  private readonly config: UniswapClientConfig;

  constructor(config: UniswapClientConfig) {
    this.config = config;
  }

  async getPrice(tokenInSymbol: string, tokenOutSymbol: string): Promise<PriceResult> {
    const tokenIn = resolveToken(tokenInSymbol, this.config.chainId);
    const tokenOut = resolveToken(tokenOutSymbol, this.config.chainId);
    const decimalsIn = tokenDecimals(tokenInSymbol, this.config.chainId);

    const probeAmount = toBaseUnits(1, decimalsIn);
    const body: QuoteRequestBody = {
      type: "EXACT_INPUT",
      amount: probeAmount,
      tokenIn,
      tokenOut,
      tokenInChainId: this.config.chainId,
      tokenOutChainId: this.config.chainId,
      swapper: this.config.swapperAddress,
      slippageTolerance: 0.5,
    };

    const data = await this.requestWithRetry<QuoteResponse>("/quote", body, "UNISWAP_QUOTE_FAILED");
    const amounts = extractAmounts(data, probeAmount);

    if (!amounts) {
      throw new Error(`Could not extract amounts from quote response. Keys: ${Object.keys(data.quote ?? {}).join(", ")}`);
    }

    const decimalsOut = tokenDecimals(tokenOutSymbol, this.config.chainId);
    const outHuman = fromBaseUnits(amounts.amountOut, decimalsOut);
    const price = outHuman === 0 ? 0 : 1 / outHuman;

    return {
      price,
      tokenIn,
      tokenOut,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut,
      routing: data.routing ?? "unknown",
      fetchedAt: new Date(),
    };
  }

  async getQuote(input: QuoteRequest): Promise<SwapQuoteResult> {
    const tokenIn = resolveToken(input.tokenInSymbol, this.config.chainId);
    const tokenOut = resolveToken(input.tokenOutSymbol, this.config.chainId);
    const decimalsIn = tokenDecimals(input.tokenInSymbol, this.config.chainId);
    const decimalsOut = tokenDecimals(input.tokenOutSymbol, this.config.chainId);
    const amount = toBaseUnits(input.amountHuman, decimalsIn);

    const body: QuoteRequestBody = {
      type: "EXACT_INPUT",
      amount,
      tokenIn,
      tokenOut,
      tokenInChainId: this.config.chainId,
      tokenOutChainId: this.config.chainId,
      swapper: input.swapperAddress ?? this.config.swapperAddress,
      slippageTolerance: input.slippageTolerance ?? 0.5,
    };

    const raw = await this.requestWithRetry<QuoteResponse>("/quote", body, "UNISWAP_QUOTE_FAILED");
    const amounts = extractAmounts(raw, amount);
    if (!amounts) {
      throw new AppError("UNISWAP_QUOTE_FAILED", "Could not extract token amounts from Uniswap quote response", {
        statusCode: 502,
        details: { tokenIn: input.tokenInSymbol, tokenOut: input.tokenOutSymbol },
      });
    }

    return {
      raw,
      tokenIn,
      tokenOut,
      tokenInSymbol: input.tokenInSymbol,
      tokenOutSymbol: input.tokenOutSymbol,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut,
      amountInHuman: input.amountHuman,
      amountOutHuman: fromBaseUnits(amounts.amountOut, decimalsOut),
      routing: raw.routing ?? "unknown",
    };
  }

  async checkApproval(quote: SwapQuoteResult): Promise<ApprovalCheckResult> {
    const raw = await this.requestWithRetry<Record<string, unknown>>(
      "/check_approval",
      {
        token: quote.tokenIn,
        amount: quote.amountIn,
        walletAddress: this.config.swapperAddress,
        chainId: this.config.chainId,
      },
      "UNISWAP_QUOTE_FAILED",
    );

    const approval = extractObject(raw, ["approval", "permit", "approvalTransaction"]);
    const spender = extractString(approval, ["spender", "tokenApprovalAddress", "to"]) ?? extractString(raw, ["spender", "tokenApprovalAddress"]);
    const approvalNeeded = Boolean(
      extractBoolean(raw, ["approvalNeeded", "needsApproval", "requiresApproval"]) ??
      extractBoolean(approval, ["approvalNeeded", "needsApproval", "requiresApproval"]) ??
      spender,
    );

    return {
      raw,
      approvalNeeded,
      ...(spender ? { spender } : {}),
      amount: quote.amountIn,
    };
  }

  async buildSwap(quote: SwapQuoteResult): Promise<SwapBuildResult> {
    const raw = await this.requestWithRetry<Record<string, unknown>>(
      "/swap",
      { quote: quote.raw.quote ?? quote.raw },
      "UNISWAP_SWAP_BUILD_FAILED",
    );

    const transaction = extractTransaction(raw);
    const approval = extractObject(raw, ["approval", "approvalTransaction", "permit"]);
    const spender = extractString(approval, ["spender", "tokenApprovalAddress", "to"]) ?? extractString(raw, ["spender", "tokenApprovalAddress"]);
    const contractCall = extractKeeperCompatibleContractCall(raw);

    return {
      raw,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      ...(spender ? { spender } : {}),
      ...(transaction ? { transaction } : {}),
      ...(contractCall ? { contractCall } : {}),
    };
  }

  private async requestWithRetry<T>(
    path: string,
    body: unknown,
    errorCode: "UNISWAP_QUOTE_FAILED" | "UNISWAP_SWAP_BUILD_FAILED",
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const resp = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "x-api-key": this.config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (resp.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          lastError = new Error(`Rate limited (429), retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }

        if (resp.status >= 500) {
          const delay = Math.pow(2, attempt) * 500;
          lastError = new Error(`Server error (${resp.status}), retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new AppError(errorCode, `Uniswap API error ${resp.status}`, {
            statusCode: resp.status >= 500 ? 502 : 400,
            details: { status: resp.status, response: text.slice(0, 1000), path },
          });
        }

        return (await resp.json()) as T;
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await sleep(Math.pow(2, attempt) * 500);
        }
      }
    }

    throw lastError ?? new AppError(errorCode, "Uniswap request failed after retries", { statusCode: 502, details: { path } });
  }
}

function extractObject(raw: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function extractString(raw: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function extractBoolean(raw: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function extractTransaction(raw: Record<string, unknown>): SwapBuildResult["transaction"] | undefined {
  const transaction =
    extractObject(raw, ["transaction", "tx"]) ??
    extractObject(extractObject(raw, ["swap"]) ?? {}, ["transaction", "tx"]);

  if (!transaction) return undefined;

  const to = extractString(transaction, ["to", "target", "contractAddress"]);
  const data = extractString(transaction, ["data", "calldata", "input"]);
  const value = extractString(transaction, ["value"]) ?? "0";
  if (!to && !data) return undefined;
  return { ...(to ? { to } : {}), ...(data ? { data } : {}), value };
}

function extractKeeperCompatibleContractCall(raw: Record<string, unknown>): KeeperCompatibleContractCall | undefined {
  const source =
    extractObject(raw, ["contractCall", "keeperhubContractCall"]) ??
    extractObject(extractObject(raw, ["swap"]) ?? {}, ["contractCall", "keeperhubContractCall"]);
  if (!source) return undefined;

  const contractAddress = extractString(source, ["contractAddress", "to"]);
  const functionName = extractString(source, ["functionName"]);
  const value = extractString(source, ["value"]) ?? "0";
  const abi = source.abi;
  const functionArgs = source.functionArgs;

  if (!contractAddress || !functionName || !Array.isArray(abi)) {
    return undefined;
  }

  return {
    contractAddress,
    functionName,
    functionArgs: Array.isArray(functionArgs) ? functionArgs : [],
    abi,
    value,
  };
}
