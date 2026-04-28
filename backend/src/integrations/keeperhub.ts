import { decodeFunctionData, type Abi } from "viem";
import type { TradeEvent } from "../types.js";

export interface KeeperHubClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface KeeperHubSubmitResult {
  executionId: string;
  status: string;
  raw: unknown;
}

export interface KeeperHubExecutionStatus {
  executionId: string;
  status: string;
  type?: string;
  transactionHash?: string | null;
  transactionLink?: string | null;
  gasUsedWei?: string | null;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string;
  raw: unknown;
}

/** Universal Router-style `execute` overloads used by Uniswap Trading API `/swap` calldata */
const UNIVERSAL_ROUTER_EXECUTE_ABI: Abi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    outputs: [],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function chainIdToKeeperHubNetwork(chainId: number): string {
  switch (chainId) {
    case 1:
      return "ethereum";
    case 5:
      return "goerli";
    case 11155111:
      return "sepolia";
    case 8453:
      return "base";
    case 84532:
      return "base-sepolia";
    case 42161:
      return "arbitrum";
    case 421614:
      return "arbitrum-sepolia";
    case 137:
      return "polygon";
    case 10:
      return "optimism";
    case 56:
      return "bsc";
    default:
      return "ethereum";
  }
}

/** Normalize tx `value` from Uniswap (hex wei or decimal string) to decimal wei string for KeeperHub */
export function normalizeTxValueWei(value: string | undefined): string {
  if (value === undefined || value === "" || value === "0x0") return "0";
  const v = value.trim();
  if (v.startsWith("0x")) {
    try {
      return BigInt(v).toString();
    } catch {
      return "0";
    }
  }
  return v;
}

/**
 * Encode viem-decoded arguments as a JSON array string for KeeperHub `functionArgs`.
 * Bigints become decimal strings; nested `bytes[]` become string[] of hex.
 */
export function encodeFunctionArgsJson(args: readonly unknown[]): string {
  const normalized = args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    if (Array.isArray(a)) {
      return a.map((x) => {
        if (typeof x === "bigint") return x.toString();
        return String(x);
      });
    }
    return typeof a === "string" ? a : String(a);
  });
  return JSON.stringify(normalized);
}

export function decodeUniversalRouterExecuteCalldata(data: string | undefined): {
  functionName: "execute";
  functionArgsJson: string;
  abiJson: string;
} | null {
  if (!data || !data.startsWith("0x") || data.length < 10) return null;

  try {
    const decoded = decodeFunctionData({
      abi: UNIVERSAL_ROUTER_EXECUTE_ABI,
      data: data as `0x${string}`,
    });
    const functionArgsJson = encodeFunctionArgsJson(decoded.args as readonly unknown[]);
    return {
      functionName: "execute",
      functionArgsJson,
      abiJson: JSON.stringify(UNIVERSAL_ROUTER_EXECUTE_ABI),
    };
  } catch {
    return null;
  }
}

function unwrapPayload<T extends Record<string, unknown>>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json && (json as { data: unknown }).data !== undefined) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export class KeeperHubClient {
  constructor(private readonly cfg: KeeperHubClientConfig) {}

  private buildUrl(path: string): string {
    const base = stripTrailingSlash(this.cfg.baseUrl);
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base}${p}`;
  }

  async submitUnsignedSwap(
    unsigned: NonNullable<TradeEvent["unsignedSwap"]>,
    chainId: number,
  ): Promise<{ ok: true; result: KeeperHubSubmitResult; httpRetries: number } | { ok: false; error: string; httpRetries: number }> {
    const data = unsigned.data;
    const to = unsigned.to;
    if (!to || !data) {
      return { ok: false, error: "unsigned swap missing `to` or `data`", httpRetries: 0 };
    }

    const decoded = decodeUniversalRouterExecuteCalldata(data);
    if (!decoded) {
      return {
        ok: false,
        error:
          "Could not decode Universal Router calldata for KeeperHub (expected execute(bytes,bytes[],uint256) or execute(bytes,bytes[]))",
        httpRetries: 0,
      };
    }

    const network = chainIdToKeeperHubNetwork(unsigned.chainId ?? chainId);
    const valueWei = normalizeTxValueWei(unsigned.value);

    const body = {
      contractAddress: to,
      network,
      functionName: decoded.functionName,
      functionArgs: decoded.functionArgsJson,
      abi: decoded.abiJson,
      value: valueWei,
      gasLimitMultiplier: "1.2",
    };

    let httpRetries = 0;
    const max = Math.max(0, this.cfg.maxRetries);
    let lastErr = "KeeperHub request failed";

    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
        const resp = await fetch(this.buildUrl("/execute/contract-call"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            "X-API-Key": this.cfg.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await resp.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (resp.status === 429) {
          httpRetries += 1;
          const retryAfter = Number(resp.headers.get("retry-after") ?? "2");
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
          continue;
        }

        if (!resp.ok) {
          const errMsg =
            typeof json === "object" && json !== null && "error" in json
              ? JSON.stringify((json as { error: unknown }).error)
              : text || resp.statusText;
          lastErr = `KeeperHub contract-call failed (${resp.status}): ${errMsg}`;
          if (resp.status >= 500 && attempt < max) {
            httpRetries += 1;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          return { ok: false, error: lastErr, httpRetries };
        }

        const payload = unwrapPayload<Record<string, unknown>>(json);
        const executionId =
          (typeof payload.executionId === "string" && payload.executionId) ||
          (typeof (payload as { execution_id?: string }).execution_id === "string" &&
            (payload as { execution_id: string }).execution_id) ||
          "";
        const status = typeof payload.status === "string" ? payload.status : "unknown";

        if (!executionId) {
          return {
            ok: false,
            error: "KeeperHub contract-call response missing executionId",
            httpRetries,
          };
        }

        return {
          ok: true,
          result: { executionId, status, raw: json },
          httpRetries,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < max) {
          httpRetries += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return { ok: false, error: lastErr, httpRetries };
      }
    }

    return { ok: false, error: lastErr, httpRetries };
  }

  async getExecutionStatus(executionId: string): Promise<
    | { ok: true; status: KeeperHubExecutionStatus; httpRetries: number }
    | { ok: false; error: string; httpRetries: number }
  > {
    let httpRetries = 0;
    const max = Math.max(0, this.cfg.maxRetries);
    let lastErr = "KeeperHub status request failed";
    const encoded = encodeURIComponent(executionId);

    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
        const resp = await fetch(this.buildUrl(`/execute/${encoded}/status`), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-API-Key": this.cfg.apiKey,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await resp.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (resp.status === 429) {
          httpRetries += 1;
          const retryAfter = Number(resp.headers.get("retry-after") ?? "2");
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
          continue;
        }

        if (!resp.ok) {
          const errMsg =
            typeof json === "object" && json !== null && "error" in json
              ? JSON.stringify((json as { error: unknown }).error)
              : text || resp.statusText;
          lastErr = `KeeperHub status failed (${resp.status}): ${errMsg}`;
          if (resp.status >= 500 && attempt < max) {
            httpRetries += 1;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          return { ok: false, error: lastErr, httpRetries };
        }

        const payload = unwrapPayload<Record<string, unknown>>(json);
        const st: KeeperHubExecutionStatus = {
          executionId: (typeof payload.executionId === "string" && payload.executionId) || executionId,
          status: typeof payload.status === "string" ? payload.status : "unknown",
          type: typeof payload.type === "string" ? payload.type : undefined,
          transactionHash:
            typeof payload.transactionHash === "string"
              ? payload.transactionHash
              : typeof (payload as { transaction_hash?: string }).transaction_hash === "string"
                ? (payload as { transaction_hash: string }).transaction_hash
                : null,
          transactionLink:
            typeof payload.transactionLink === "string"
              ? payload.transactionLink
              : typeof (payload as { transaction_link?: string }).transaction_link === "string"
                ? (payload as { transaction_link: string }).transaction_link
                : null,
          gasUsedWei:
            typeof payload.gasUsedWei === "string"
              ? payload.gasUsedWei
              : typeof (payload as { gas_used_wei?: string }).gas_used_wei === "string"
                ? (payload as { gas_used_wei: string }).gas_used_wei
                : null,
          result: "result" in payload ? payload.result : undefined,
          error:
            payload.error === null || payload.error === undefined
              ? null
              : typeof payload.error === "string"
                ? payload.error
                : JSON.stringify(payload.error),
          createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
          completedAt: typeof payload.completedAt === "string" ? payload.completedAt : undefined,
          raw: json,
        };

        return { ok: true, status: st, httpRetries };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < max) {
          httpRetries += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return { ok: false, error: lastErr, httpRetries };
      }
    }

    return { ok: false, error: lastErr, httpRetries };
  }
}
