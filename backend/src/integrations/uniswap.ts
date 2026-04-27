import { resolveToken, tokenDecimals, fromBaseUnits } from "./tokens.js";

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
    const tokenIn = resolveToken(tokenInSymbol);
    const tokenOut = resolveToken(tokenOutSymbol);
    const decimalsIn = tokenDecimals(tokenInSymbol);

    const probeAmount = toBaseUnitsFromDecimals(1, decimalsIn);
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

    const data = await this.requestWithRetry(body);
    const amounts = extractAmounts(data, probeAmount);

    if (!amounts) {
      throw new Error(`Could not extract amounts from quote response. Keys: ${Object.keys(data.quote ?? {}).join(", ")}`);
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
      routing: data.routing ?? "unknown",
      fetchedAt: new Date(),
    };
  }

  private async requestWithRetry(body: QuoteRequestBody): Promise<QuoteResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const resp = await fetch(`${this.config.baseUrl}/quote`, {
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
          throw new Error(`Uniswap API error ${resp.status}: ${text}`);
        }

        return (await resp.json()) as QuoteResponse;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await sleep(Math.pow(2, attempt) * 500);
        }
      }
    }

    throw lastError ?? new Error("Uniswap quote request failed after retries");
  }
}

function toBaseUnitsFromDecimals(amount: number, decimals: number): string {
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}
