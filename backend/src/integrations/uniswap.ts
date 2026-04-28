import { resolveToken, tokenDecimals, fromBaseUnits } from "./tokens.js";

export interface UniswapClientConfig {
  apiKey: string;
  baseUrl: string;
  chainId: number;
  swapperAddress: string;
  timeoutMs: number;
  maxRetries: number;
  permit2Disabled: boolean;
  universalRouterVersion: string;
  /** Used when `/quote` returns `permitData` and you need POST /swap without disabling Permit2. */
  permitSignature: string;
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

/** Full `/quote` response shape (classic or UniswapX — we only parse amounts where possible). */
export interface UniswapQuoteResponse {
  quote?: unknown;
  routing?: string;
  requestId?: string;
  permitData?: unknown;
  [key: string]: unknown;
}

export interface ExactInputQuoteResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  routing: string;
  requestId?: string;
  /** Full API response for downstream `/swap` (live mode) or mock metadata. */
  raw: UniswapQuoteResponse;
}

export interface CheckApprovalResult {
  /** Raw `/check_approval` JSON. */
  raw: Record<string, unknown>;
  requestId?: string;
}

export interface MockSwapBuild {
  mode: "mock";
  chainId: number;
  routing?: string;
  /** Key fields from the quote for demos; full calldata only comes from real `POST /swap`. */
  quoteSnippet: {
    amountIn?: string;
    amountOut?: string;
  };
  note: string;
}

/** Successful `POST /swap` — contains unsigned tx fields for signing/broadcast. */
export interface CreateSwapResult {
  requestId?: string;
  swap: {
    to?: string;
    from?: string;
    data?: string;
    value?: string;
    chainId?: number;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  gasFee?: string;
  raw: Record<string, unknown>;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function gasUsdFromQuoteResponse(raw: UniswapQuoteResponse): number | undefined {
  const q = raw.quote;
  if (!q || typeof q !== "object") return undefined;
  const rec = q as Record<string, unknown>;
  const g = rec.gasFeeUSD;
  if (typeof g === "number" && Number.isFinite(g)) return g;
  if (typeof g === "string") {
    const n = Number(g);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function extractAmountsFromQuoteResponse(data: UniswapQuoteResponse): { amountIn: string; amountOut: string } | null {
  const quote = data.quote;
  if (!quote || typeof quote !== "object") return null;

  if ("amountIn" in quote && "amountOut" in quote) {
    return {
      amountIn: String((quote as ClassicQuote).amountIn),
      amountOut: String((quote as ClassicQuote).amountOut),
    };
  }

  /** Trading API variant: `quote.input` / `quote.output` with `amount` (base units) per token */
  if ("input" in quote && "output" in quote) {
    const inp = (quote as { input?: unknown }).input;
    const out = (quote as { output?: unknown }).output;
    if (inp && out && typeof inp === "object" && typeof out === "object") {
      const inRec = inp as Record<string, unknown>;
      const outRec = out as Record<string, unknown>;
      const ai = inRec.amount;
      const ao = outRec.amount;
      if (typeof ai === "string" && typeof ao === "string" && ai.length > 0 && ao.length > 0) {
        return { amountIn: ai, amountOut: ao };
      }
    }
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
    const tokenIn = resolveToken(tokenInSymbol);
    const tokenOut = resolveToken(tokenOutSymbol);
    const decimalsIn = tokenDecimals(tokenInSymbol);

    const probeAmount = toBaseUnitsFromDecimals(1, decimalsIn);
    const body = this.buildQuoteBody(tokenIn, tokenOut, probeAmount);

    const data = await this.postQuoteWithRetry(body);
    const amounts = extractAmountsFromQuoteResponse(data);

    if (!amounts) {
      throw new Error(`Could not extract amounts from quote response. Keys: ${Object.keys((data.quote ?? {}) as object).join(", ")}`);
    }

    const decimalsOut = tokenDecimals(tokenOutSymbol);
    const outHuman = fromBaseUnits(amounts.amountOut, decimalsOut);
    const price = outHuman === 0 ? 0 : 1 / outHuman;

    return {
      price,
      tokenIn,
      tokenOut,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut,
      routing: typeof data.routing === "string" ? data.routing : "unknown",
      fetchedAt: new Date(),
    };
  }

  /**
   * EXACT_INPUT quote for a specific size (base units). Used for paper fills from real routes.
   */
  async getExactInputQuote(params: {
    tokenInSymbol: string;
    tokenOutSymbol: string;
    amountInBaseUnits: string;
    slippageTolerance?: number;
  }): Promise<ExactInputQuoteResult> {
    const tokenIn = resolveToken(params.tokenInSymbol);
    const tokenOut = resolveToken(params.tokenOutSymbol);
    const body = this.buildQuoteBody(tokenIn, tokenOut, params.amountInBaseUnits, params.slippageTolerance);

    const raw = await this.postQuoteWithRetry(body);
    const amounts = extractAmountsFromQuoteResponse(raw);

    if (!amounts) {
      throw new Error(`Could not extract amounts from quote response. Keys: ${Object.keys((raw.quote ?? {}) as object).join(", ")}`);
    }

    return {
      tokenIn,
      tokenOut,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut,
      routing: typeof raw.routing === "string" ? raw.routing : "unknown",
      requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
      raw,
    };
  }

  /**
   * Real `POST /check_approval` — verifies Permit2/proxy allowance for the swapper wallet.
   */
  async checkApproval(params: {
    tokenInSymbolOrAddress: string;
    amountBaseUnits: string;
    walletAddress?: string;
  }): Promise<CheckApprovalResult> {
    const token = resolveToken(params.tokenInSymbolOrAddress);
    const walletAddress = params.walletAddress ?? this.config.swapperAddress;
    const body = {
      walletAddress,
      token,
      amount: params.amountBaseUnits,
      chainId: this.config.chainId,
    };

    const raw = await this.postWithRetry<Record<string, unknown>>("/check_approval", body);
    const requestId = typeof raw.requestId === "string" ? raw.requestId : undefined;

    return { raw, requestId };
  }

  /**
   * Does **not** call `POST /swap`. Builds demo metadata from a real quote so production can swap `quote` → `POST /swap` later.
   */
  /**
   * Real `POST /swap` — returns unsigned transaction (`swap`) for wallet signing / RPC broadcast.
   * If `/quote` returned `permitData`, you must supply an EIP-712 signature (see `UNISWAP_PERMIT_SIGNATURE`)
   * or use `UNISWAP_PERMIT2_DISABLED=true` so quotes omit Permit2.
   */
  async createProtocolSwap(
    fullQuoteResponse: UniswapQuoteResponse,
    options?: { signature?: string },
  ): Promise<CreateSwapResult> {
    const quoteObj = fullQuoteResponse.quote;
    if (!quoteObj || typeof quoteObj !== "object") {
      throw new Error("Quote response missing nested `quote`; cannot POST /swap");
    }

    const permitData = fullQuoteResponse.permitData;
    const sigRaw = options?.signature ?? this.config.permitSignature?.trim();
    const sig = sigRaw && sigRaw.length > 0
      ? (sigRaw.startsWith("0x") ? sigRaw : `0x${sigRaw}`)
      : undefined;

    const body: Record<string, unknown> = {
      quote: quoteObj,
      refreshGasPrice: true,
      simulateTransaction: false,
    };

    if (permitData != null && typeof permitData === "object") {
      if (!sig) {
        throw new Error(
          "Quote returned permitData but no signature was provided. Set UNISWAP_PERMIT_SIGNATURE, or set UNISWAP_PERMIT2_DISABLED=true for proxy approval flow.",
        );
      }
      body.signature = sig;
      body.permitData = permitData;
    }

    const raw = await this.postWithRetry<Record<string, unknown>>("/swap", body);

    const swapUnknown = raw.swap;
    if (!swapUnknown || typeof swapUnknown !== "object") {
      throw new Error("POST /swap response missing `swap` object");
    }
    const swap = swapUnknown as Record<string, unknown>;

    return {
      requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
      swap: {
        to: typeof swap.to === "string" ? swap.to : undefined,
        from: typeof swap.from === "string" ? swap.from : undefined,
        data: typeof swap.data === "string" ? swap.data : undefined,
        value: typeof swap.value === "string" ? swap.value : undefined,
        chainId: typeof swap.chainId === "number" ? swap.chainId : undefined,
        gasLimit: typeof swap.gasLimit === "string" ? swap.gasLimit : undefined,
        maxFeePerGas: typeof swap.maxFeePerGas === "string" ? swap.maxFeePerGas : undefined,
        maxPriorityFeePerGas: typeof swap.maxPriorityFeePerGas === "string" ? swap.maxPriorityFeePerGas : undefined,
      },
      gasFee: typeof raw.gasFee === "string" ? raw.gasFee : undefined,
      raw: raw as Record<string, unknown>,
    };
  }

  buildMockSwapBuild(fullQuoteResponse: UniswapQuoteResponse): MockSwapBuild {
    const amounts = extractAmountsFromQuoteResponse(fullQuoteResponse);
    const routing = typeof fullQuoteResponse.routing === "string" ? fullQuoteResponse.routing : undefined;

    return {
      mode: "mock",
      chainId: this.config.chainId,
      routing,
      quoteSnippet: {
        amountIn: amounts?.amountIn,
        amountOut: amounts?.amountOut,
      },
      note:
        "POST /swap was not executed. For live trading, submit `quote` from the prior /quote response to POST /swap (and sign/broadcast).",
    };
  }

  private buildQuoteBody(
    tokenIn: string,
    tokenOut: string,
    amount: string,
    slippageTolerance = 0.5,
  ): QuoteRequestBody {
    return {
      type: "EXACT_INPUT",
      amount,
      tokenIn,
      tokenOut,
      tokenInChainId: this.config.chainId,
      tokenOutChainId: this.config.chainId,
      swapper: this.config.swapperAddress,
      slippageTolerance,
    };
  }

  private async postQuoteWithRetry(body: QuoteRequestBody): Promise<UniswapQuoteResponse> {
    return this.postWithRetry<UniswapQuoteResponse>("/quote", body);
  }

  private headersForTrading(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "x-api-key": this.config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-universal-router-version": this.config.universalRouterVersion,
    };
    if (this.config.permit2Disabled) {
      headers["x-permit2-disabled"] = "true";
    }
    if (extra) {
      Object.assign(headers, extra);
    }
    return headers;
  }

  private async postWithRetry<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const headers = this.headersForTrading(extraHeaders);

        const resp = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers,
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
          throw new Error(`Uniswap API error ${resp.status}: ${text}`);
        }

        return (await resp.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await sleep(Math.pow(2, attempt) * 500);
        }
      }
    }

    throw lastError ?? new Error(`Uniswap request failed after retries (${path})`);
  }
}

function toBaseUnitsFromDecimals(amount: number, decimals: number): string {
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}
