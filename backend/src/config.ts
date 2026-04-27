export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  backendMode: "dummy" | "real";
  simSeed: number;
  simTickMs: number;
  simErrorRate: number;
  llm: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
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
    llm: {
      provider: llmProvider,
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.LLM_BASE_URL ?? defaultBaseUrl,
    },
  };
}

export function isAnthropicProvider(provider: string): boolean {
  return provider === "anthropic";
}
