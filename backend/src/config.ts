export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  backendMode: "dummy" | "real";
  simSeed: number;
  simTickMs: number;
  simErrorRate: number;
  databaseUrl: string;
  llm: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  uniswap: {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    chainId: number;
    swapperAddress: string;
    timeoutMs: number;
    maxRetries: number;
  };
  agents: {
    pythonPath: string;
    packageDir: string;
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

export function getConfig(): AppConfig {
  const llmProvider = process.env.LLM_PROVIDER ?? "openai";
  const defaultBaseUrl = llmProvider === "anthropic"
    ? "https://api.anthropic.com/v1"
    : "https://api.openai.com/v1";

  return {
    port: envNumber("PORT", 8787),
    host: process.env.HOST ?? "0.0.0.0",
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    backendMode: process.env.BACKEND_MODE === "real" ? "real" : "dummy",
    simSeed: envNumber("SIM_SEED", 42),
    simTickMs: envNumber("SIM_TICK_MS", 2000),
    simErrorRate: envNumber("SIM_ERROR_RATE", 0),
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://agentslam:agentslam@localhost:5432/agentslam",
    llm: {
      provider: llmProvider,
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.LLM_BASE_URL ?? defaultBaseUrl,
    },
    uniswap: {
      enabled: process.env.UNISWAP_ENABLED === "true",
      apiKey: process.env.UNISWAP_API_KEY ?? "",
      baseUrl: process.env.UNISWAP_BASE_URL ?? "https://trade-api.gateway.uniswap.org/v1",
      chainId: envNumber("UNISWAP_CHAIN_ID", 1),
      swapperAddress: process.env.UNISWAP_SWAPPER_ADDRESS ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      timeoutMs: envNumber("UNISWAP_TIMEOUT_MS", 15000),
      maxRetries: envNumber("UNISWAP_MAX_RETRIES", 2),
    },
    agents: {
      pythonPath: process.env.AGENTS_PYTHON_PATH ?? "python3",
      packageDir: process.env.AGENTS_PACKAGE_DIR ?? "",
    },
  };
}

