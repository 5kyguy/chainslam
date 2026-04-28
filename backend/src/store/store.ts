import type { AgentState, AgentStatus, AgentStats, DecisionEvent, FeedEvent, LeaderboardEntry, MatchState, TradeEvent, WsEnvelope } from "../types.js";

export interface Store {
  saveMatch(match: MatchState): void;
  getMatch(id: string): MatchState | undefined;
  updateMatch(match: MatchState): void;

  addTrade(matchId: string, trade: TradeEvent): void;
  /** Merge execution fields into an existing trade (KeeperHub receipts, tx hash). Idempotent per `tradeRecordId`. */
  updateTradeExecution(matchId: string, tradeRecordId: string, patch: Partial<TradeEvent>): void;
  addDecision(matchId: string, decision: DecisionEvent): void;
  getTrades(matchId: string): TradeEvent[];
  getFeed(matchId: string): FeedEvent[];

  setLeaderboard(entries: LeaderboardEntry[]): void;
  getLeaderboard(): LeaderboardEntry[];

  saveAgent(agent: AgentState): void;
  getAgent(id: string): AgentState | undefined;
  listAgents(): AgentState[];
  deleteAgent(id: string): boolean;
  updateAgentStatus(id: string, status: AgentStatus): void;
  updateAgentStats(id: string, result: "win" | "loss" | "draw", pnlPct: number): void;

  subscribe(matchId: string, listener: (event: WsEnvelope) => void): () => void;
  publish(matchId: string, message: WsEnvelope): void;

  setInterval(matchId: string, interval: NodeJS.Timeout): void;
  getInterval(matchId: string): NodeJS.Timeout | undefined;
  deleteInterval(matchId: string): void;

  init(): Promise<void>;
  close(): Promise<void>;
}
