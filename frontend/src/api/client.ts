import type {
  AgentCreateRequest,
  AgentState,
  FeedEvent,
  KeeperHubExecutionAudit,
  LeaderboardEntry,
  MatchCreateRequest,
  MatchState,
  MatchStatus,
  MemoryPage,
  StrategyOption,
  TradeEvent,
  ZeroGSnapshot,
} from "../types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (!configuredApiBaseUrl) {
  throw new Error("VITE_API_BASE_URL is required. Set it in frontend/.env.");
}

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/$/, "");

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message ?? message;
    } catch {
      // Leave the HTTP status as the error message.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  health: () => request<{ ok: true }>("/health"),
  getStrategies: () => request<StrategyOption[]>("/api/strategies"),
  createAgent: (body: AgentCreateRequest) => request<AgentState>("/api/agents", { method: "POST", body }),
  createMatch: (body: MatchCreateRequest) => request<MatchState>("/api/matches", { method: "POST", body }),
  getMatch: (id: string) => request<MatchState>(`/api/matches/${encodeURIComponent(id)}`),
  stopMatch: (id: string) => request<MatchState>(`/api/matches/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  listMatches: (params: { status?: MatchStatus; limit?: number; offset?: number } = {}) =>
    request<MatchState[]>(`/api/matches${query({ limit: 50, ...params })}`),
  getFeed: (id: string) => request<FeedEvent[]>(`/api/matches/${encodeURIComponent(id)}/feed`),
  getTrades: (id: string) => request<TradeEvent[]>(`/api/matches/${encodeURIComponent(id)}/trades`),
  getExecutions: (id: string) => request<KeeperHubExecutionAudit[]>(`/api/matches/${encodeURIComponent(id)}/executions`),
  getLeaderboard: () => request<LeaderboardEntry[]>("/api/leaderboard"),
  getMemory: (id: string, params: { limit?: number; cursor?: number } = {}) =>
    request<MemoryPage>(`/api/matches/${encodeURIComponent(id)}/memory${query({ limit: 100, ...params })}`),
  getZeroGMemory: (id: string) => request<ZeroGSnapshot>(`/api/matches/${encodeURIComponent(id)}/memory/zg`),
};
