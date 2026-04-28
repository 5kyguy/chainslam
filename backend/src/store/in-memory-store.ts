import type { AgentState, AgentStatus, AgentStats, DecisionEvent, FeedEvent, LeaderboardEntry, MatchState, TradeEvent, WsEnvelope } from "../types.js";
import type { Store } from "./store.js";

export class InMemoryStore implements Store {
  protected readonly agentsById = new Map<string, AgentState>();
  protected readonly matchesById = new Map<string, MatchState>();
  protected readonly tradeHistoryByMatchId = new Map<string, TradeEvent[]>();
  protected readonly decisionFeedByMatchId = new Map<string, DecisionEvent[]>();
  protected readonly wsSubscribersByMatchId = new Map<string, Set<(event: WsEnvelope) => void>>();
  protected readonly intervalsByMatchId = new Map<string, NodeJS.Timeout>();
  protected leaderboardEntries: LeaderboardEntry[] = [];

  saveMatch(match: MatchState): void {
    this.matchesById.set(match.id, match);
  }

  getMatch(id: string): MatchState | undefined {
    return this.matchesById.get(id);
  }

  updateMatch(match: MatchState): void {
    this.matchesById.set(match.id, match);
  }

  addTrade(matchId: string, trade: TradeEvent): void {
    const trades = this.tradeHistoryByMatchId.get(matchId) ?? [];
    trades.push(trade);
    this.tradeHistoryByMatchId.set(matchId, trades);
  }

  updateTradeExecution(matchId: string, tradeRecordId: string, patch: Partial<TradeEvent>): void {
    const trades = this.tradeHistoryByMatchId.get(matchId);
    if (!trades) return;
    const idx = trades.findIndex((t) => t.tradeRecordId === tradeRecordId);
    if (idx === -1) return;
    trades[idx] = { ...trades[idx], ...patch };
    this.tradeHistoryByMatchId.set(matchId, trades);
  }

  addDecision(matchId: string, decision: DecisionEvent): void {
    const feed = this.decisionFeedByMatchId.get(matchId) ?? [];
    feed.push(decision);
    this.decisionFeedByMatchId.set(matchId, feed);
  }

  getTrades(matchId: string): TradeEvent[] {
    return this.tradeHistoryByMatchId.get(matchId) ?? [];
  }

  getFeed(matchId: string): FeedEvent[] {
    return this.decisionFeedByMatchId.get(matchId) ?? [];
  }

  setLeaderboard(entries: LeaderboardEntry[]): void {
    this.leaderboardEntries = entries;
  }

  getLeaderboard(): LeaderboardEntry[] {
    return this.leaderboardEntries;
  }

  saveAgent(agent: AgentState): void {
    this.agentsById.set(agent.id, agent);
  }

  getAgent(id: string): AgentState | undefined {
    return this.agentsById.get(id);
  }

  listAgents(): AgentState[] {
    return [...this.agentsById.values()];
  }

  deleteAgent(id: string): boolean {
    const agent = this.agentsById.get(id);
    if (!agent || agent.status === "in_match") return false;
    this.agentsById.delete(id);
    return true;
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    const agent = this.agentsById.get(id);
    if (agent) agent.status = status;
  }

  updateAgentStats(id: string, result: "win" | "loss" | "draw", pnlPct: number): void {
    const agent = this.agentsById.get(id);
    if (!agent) return;
    const s = agent.stats;
    s.matchesPlayed += 1;
    if (result === "win") s.wins += 1;
    else if (result === "loss") s.losses += 1;
    else s.draws += 1;
    const totalPnl = s.avgPnlPct * (s.matchesPlayed - 1) + pnlPct;
    s.avgPnlPct = Number(totalPnl.toFixed(2));
  }

  subscribe(matchId: string, listener: (event: WsEnvelope) => void): () => void {
    const current = this.wsSubscribersByMatchId.get(matchId) ?? new Set<(event: WsEnvelope) => void>();
    current.add(listener);
    this.wsSubscribersByMatchId.set(matchId, current);

    return () => {
      const listeners = this.wsSubscribersByMatchId.get(matchId);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.wsSubscribersByMatchId.delete(matchId);
    };
  }

  publish(matchId: string, message: WsEnvelope): void {
    const listeners = this.wsSubscribersByMatchId.get(matchId);
    if (!listeners) return;
    for (const listener of listeners) listener(message);
  }

  setInterval(matchId: string, interval: NodeJS.Timeout): void {
    this.intervalsByMatchId.set(matchId, interval);
  }

  getInterval(matchId: string): NodeJS.Timeout | undefined {
    return this.intervalsByMatchId.get(matchId);
  }

  deleteInterval(matchId: string): void {
    this.intervalsByMatchId.delete(matchId);
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {}
}
