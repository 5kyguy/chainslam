import type { MatchCreateRequest, MatchState } from "../types.js";
import type { MemoryPage, MemoryQuery } from "./zerog-memory-service.js";

export interface MatchService {
  createMatch(input: MatchCreateRequest): MatchState;
  getMatch(id: string): MatchState | undefined;
  getTrades(id: string): unknown[];
  getFeed(id: string): unknown[];
  stopMatch(id: string): MatchState | undefined;
  getStrategies(): unknown[];
  getLeaderboard(): unknown[];
  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void;

  /** Phase 7C — agent/match memory timeline (in-process + optional 0G KV mirror). */
  getMatchMemory(matchId: string, query?: MemoryQuery): MemoryPage;
  getAgentMemory(agentId: string, query?: MemoryQuery): MemoryPage;
  /** Raw JSON snapshot stored under the match aggregate key (requires ZEROG KV configured). */
  getMatchMemoryFromZg(matchId: string): Promise<{ raw: string | null; configured: boolean }>;
}
