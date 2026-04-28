import type { MatchCreateRequest, MatchState } from "../types.js";

export interface MatchService {
  createMatch(input: MatchCreateRequest): MatchState | Promise<MatchState>;
  getMatch(id: string): MatchState | undefined;
  getTrades(id: string): unknown[];
  getExecutions(id: string): unknown[];
  getFeed(id: string): unknown[];
  stopMatch(id: string): MatchState | undefined;
  getStrategies(): unknown[];
  getLeaderboard(): unknown[];
  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void;
}
