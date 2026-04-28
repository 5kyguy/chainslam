import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the repo `agents/` directory (contains `chain_slam_agents/`).
 * Resolved from `backend/src` or `backend/dist` so local runs work without setting `AGENTS_PACKAGE_DIR`.
 */
export function resolveDefaultAgentsPackageDir(): string {
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(configDir, "../../agents");
}

export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  llm: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  uniswap: {
    apiKey: string;
    baseUrl: string;
    chainId: number;
    swapperAddress: string;
    timeoutMs: number;
    maxRetries: number;
    /** `mock` = never call POST /swap; `live` = build unsigned txs via POST /swap (requires signing/broadcast). */
    swapMode: "mock" | "live";
    /** When true, sends `x-permit2-disabled: true` on quote/check_approval/swap (proxy ERC-20 approve flow; no Permit2 EIP-712 sig). */
    permit2Disabled: boolean;
    /** Must stay consistent across quote and swap (Uniswap API). */
    universalRouterVersion: string;
    /** Optional hex signature for Permit2 when quote returns permitData (live swap). */
    permitSignature: string;
  };
  agents: {
    pythonPath: string;
    packageDir: string;
  };
  /** KeeperHub Direct Execution — optional; routes unsigned Uniswap swaps via `/execute/contract-call`. */
  keeperhub: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    /** Background poll interval for execution status (ms). */
    pollIntervalMs: number;
    /** Max status polls per execution before giving up. */
    maxPollAttempts: number;
  };
  /** 0G Storage — optional agent/match memory (KV) mirror for Phase 7C. */
  zerog: {
    enabled: boolean;
    evmRpc: string;
    indexerRpc: string;
    kvRpc: string;
    /** Wallet private key with gas on 0G chain for KV writes (never commit real funds). */
    privateKey: string;
    /** KV stream id (hex `0x…`) where keys are written. */
    streamId: string;
    /** Prefix for KV keys, e.g. `agentslam/v1`. */
    keyPrefix: string;
    maxRetries: number;
    /** Debounce window before flushing accumulated events to 0G (ms). */
    flushDebounceMs: number;
    /** Cooldown after a failed KV flush/write attempt (ms). Prevents tight retry loops while nodes are still syncing. */
    writeCooldownMs: number;
  };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSwapMode(raw: string | undefined): "mock" | "live" {
  const v = (raw ?? "mock").toLowerCase();
  if (v === "live") return "live";
  return "mock";
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

export function getConfig(): AppConfig {
  const llmProvider = process.env.LLM_PROVIDER ?? "openai";
  const defaultBaseUrl = llmProvider === "anthropic"
    ? "https://api.anthropic.com/v1"
    : "https://api.openai.com/v1";

  return {
    port: envNumber("PORT", 8787),
    host: process.env.HOST ?? "0.0.0.0",
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://agentslam:agentslam@localhost:5432/agentslam",
    llm: {
      provider: llmProvider,
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.LLM_BASE_URL ?? defaultBaseUrl,
    },
    uniswap: {
      apiKey: process.env.UNISWAP_API_KEY ?? "",
      baseUrl: process.env.UNISWAP_BASE_URL ?? "https://trade-api.gateway.uniswap.org/v1",
      chainId: envNumber("UNISWAP_CHAIN_ID", 1),
      swapperAddress: process.env.UNISWAP_SWAPPER_ADDRESS ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      timeoutMs: envNumber("UNISWAP_TIMEOUT_MS", 15000),
      maxRetries: envNumber("UNISWAP_MAX_RETRIES", 2),
      swapMode: parseSwapMode(process.env.UNISWAP_SWAP_MODE),
      permit2Disabled: envBool("UNISWAP_PERMIT2_DISABLED", false),
      universalRouterVersion: process.env.UNISWAP_UNIVERSAL_ROUTER_VERSION ?? "2.0",
      permitSignature: process.env.UNISWAP_PERMIT_SIGNATURE ?? "",
    },
    agents: {
      pythonPath: process.env.AGENTS_PYTHON_PATH ?? "python3",
      packageDir: process.env.AGENTS_PACKAGE_DIR ?? resolveDefaultAgentsPackageDir(),
    },
    keeperhub: {
      apiKey: process.env.KEEPERHUB_API_KEY ?? "",
      baseUrl: process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com/api",
      timeoutMs: envNumber("KEEPERHUB_TIMEOUT_MS", 30_000),
      maxRetries: envNumber("KEEPERHUB_MAX_RETRIES", 3),
      pollIntervalMs: envNumber("KEEPERHUB_POLL_INTERVAL_MS", 5000),
      maxPollAttempts: envNumber("KEEPERHUB_MAX_POLL_ATTEMPTS", 120),
    },
    zerog: {
      enabled: envBool("ZEROG_ENABLED", true),
      evmRpc: process.env.ZEROG_EVM_RPC ?? "",
      indexerRpc: process.env.ZEROG_INDEXER_RPC ?? "",
      kvRpc: process.env.ZEROG_KV_RPC ?? "",
      privateKey: process.env.ZEROG_PRIVATE_KEY ?? "",
      streamId: process.env.ZEROG_KV_STREAM_ID ?? "",
      keyPrefix: process.env.ZEROG_KEY_PREFIX ?? "agentslam/v1",
      maxRetries: envNumber("ZEROG_MAX_RETRIES", 3),
      flushDebounceMs: envNumber("ZEROG_FLUSH_DEBOUNCE_MS", 1200),
      writeCooldownMs: envNumber("ZEROG_WRITE_COOLDOWN_MS", 300000),
    },
  };
}

