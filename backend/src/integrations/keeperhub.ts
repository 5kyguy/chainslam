import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";
import type { ExecutionStatus } from "../types.js";
import type { KeeperCompatibleContractCall } from "./uniswap.js";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type KeeperHubClientConfig = AppConfig["keeperhub"];

export interface KeeperHubExecutionStatus {
  executionId: string;
  status: ExecutionStatus;
  type?: string;
  transactionHash?: string;
  transactionLink?: string;
  gasUsedWei?: string;
  result?: unknown;
  error?: unknown;
  createdAt?: string;
  completedAt?: string;
}

interface KeeperHubRequestOptions {
  idempotencyKey?: string;
}

export class KeeperHubClient {
  private readonly config: KeeperHubClientConfig;

  constructor(config: KeeperHubClientConfig) {
    this.config = config;
  }

  async executeContractCall(
    call: KeeperCompatibleContractCall,
    options: KeeperHubRequestOptions = {},
  ): Promise<KeeperHubExecutionStatus> {
    const raw = await this.request<Record<string, unknown>>(
      "/api/execute/contract-call",
      {
        contractAddress: call.contractAddress,
        network: this.config.network,
        functionName: call.functionName,
        functionArgs: JSON.stringify(call.functionArgs ?? []),
        abi: JSON.stringify(call.abi),
        value: call.value ?? "0",
        gasLimitMultiplier: this.config.gasLimitMultiplier,
      },
      options,
    );

    return this.normalizeStatus(raw);
  }

  async executeErc20Approval(input: {
    tokenAddress: string;
    spenderAddress: string;
    amountBaseUnits: string;
    idempotencyKey?: string;
  }): Promise<KeeperHubExecutionStatus> {
    return this.executeContractCall(
      {
        contractAddress: input.tokenAddress,
        functionName: "approve",
        functionArgs: [input.spenderAddress, input.amountBaseUnits],
        abi: [...ERC20_APPROVE_ABI],
        value: "0",
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async getDirectExecutionStatus(executionId: string): Promise<KeeperHubExecutionStatus> {
    const raw = await this.get<Record<string, unknown>>(`/api/execute/${encodeURIComponent(executionId)}/status`);
    return this.normalizeStatus(raw, executionId);
  }

  async waitForCompletion(initial: KeeperHubExecutionStatus): Promise<KeeperHubExecutionStatus> {
    if (initial.status === "completed" || initial.status === "failed") {
      return initial;
    }

    const deadline = Date.now() + this.config.pollTimeoutMs;
    let current = initial;

    while (Date.now() < deadline) {
      await sleep(this.config.pollIntervalMs);
      current = await this.getDirectExecutionStatus(initial.executionId);
      if (current.status === "completed" || current.status === "failed") {
        return current;
      }
    }

    throw new AppError("KEEPERHUB_EXECUTION_TIMEOUT", "KeeperHub execution did not finish before timeout", {
      statusCode: 504,
      details: { executionId: initial.executionId, status: current.status },
    });
  }

  private async request<T>(
    path: string,
    body: unknown,
    options: KeeperHubRequestOptions = {},
  ): Promise<T> {
    return this.requestWithRetry<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: options.idempotencyKey,
    });
  }

  private async get<T>(path: string): Promise<T> {
    return this.requestWithRetry<T>(path, { method: "GET" });
  }

  private async requestWithRetry<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: string; idempotencyKey?: string },
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}${path}`, {
          method: init.method,
          headers: this.headers(init.idempotencyKey),
          ...(init.body ? { body: init.body } : {}),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.pow(2, attempt) * 750;
          lastError = await this.toRequestError(response, path);
          if (attempt < this.config.maxRetries) {
            await sleep(delayMs);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          throw await this.toRequestError(response, path);
        }

        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof AppError && err.statusCode < 500 && err.code !== "KEEPERHUB_RATE_LIMITED") {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await sleep(Math.pow(2, attempt) * 750);
          continue;
        }
      }
    }

    throw lastError ?? new AppError("KEEPERHUB_REQUEST_FAILED", "KeeperHub request failed", {
      statusCode: 502,
      details: { path },
    });
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.authMode === "api-key") {
      headers["X-API-Key"] = this.config.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return headers;
  }

  private async toRequestError(response: Response, path: string): Promise<AppError> {
    const text = await response.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    const message = (extractErrorMessage(parsed) ?? text.slice(0, 300)) || `KeeperHub request failed with ${response.status}`;
    const details = {
      status: response.status,
      path,
      response: parsed ?? text.slice(0, 1000),
    };

    if (response.status === 401 || response.status === 403) {
      return new AppError("KEEPERHUB_AUTH_FAILED", "KeeperHub authentication failed", {
        statusCode: 502,
        details,
      });
    }
    if (response.status === 429) {
      return new AppError("KEEPERHUB_RATE_LIMITED", "KeeperHub rate limit exceeded", {
        statusCode: 503,
        details,
      });
    }
    if (response.status === 422) {
      return new AppError("KEEPERHUB_EXECUTION_FAILED", message, {
        statusCode: 502,
        details,
      });
    }

    return new AppError("KEEPERHUB_REQUEST_FAILED", message, {
      statusCode: response.status >= 500 ? 502 : 400,
      details,
    });
  }

  private normalizeStatus(raw: Record<string, unknown>, fallbackExecutionId?: string): KeeperHubExecutionStatus {
    const executionId = stringValue(raw.executionId) ?? stringValue(raw.id) ?? fallbackExecutionId;
    if (!executionId) {
      throw new AppError("KEEPERHUB_EXECUTION_FAILED", "KeeperHub response did not include an execution id", {
        statusCode: 502,
        details: { responseKeys: Object.keys(raw) },
      });
    }

    return {
      executionId,
      status: normalizeStatus(raw.status),
      ...(stringValue(raw.type) ? { type: stringValue(raw.type) } : {}),
      ...(stringValue(raw.transactionHash) ? { transactionHash: stringValue(raw.transactionHash) } : {}),
      ...(stringValue(raw.transactionLink) ? { transactionLink: stringValue(raw.transactionLink) } : {}),
      ...(stringValue(raw.gasUsedWei) ? { gasUsedWei: stringValue(raw.gasUsedWei) } : {}),
      ...(raw.result !== undefined ? { result: raw.result } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      ...(stringValue(raw.createdAt) ? { createdAt: stringValue(raw.createdAt) } : {}),
      ...(stringValue(raw.completedAt) ? { completedAt: stringValue(raw.completedAt) } : {}),
    };
  }
}

function normalizeStatus(raw: unknown): ExecutionStatus {
  const value = String(raw ?? "submitted").toLowerCase();
  if (value === "completed" || value === "success") return "completed";
  if (value === "failed" || value === "error" || value === "cancelled") return "failed";
  if (value === "running") return "running";
  if (value === "pending") return "pending";
  return "submitted";
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

function extractErrorMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const direct = record.error ?? record.message ?? record.details;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") {
    const nested = direct as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
