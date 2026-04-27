import type { AgentState, FeedEvent, LeaderboardEntry, MatchState, WsEnvelope } from "../types.js";

export class InMemoryStore {
  public readonly agentsById = new Map<string, AgentState>();
  public readonly matchesById = new Map<string, MatchState>();
  public readonly tradeHistoryByMatchId = new Map<string, FeedEvent[]>();
  public readonly decisionFeedByMatchId = new Map<string, FeedEvent[]>();
  public readonly wsSubscribersByMatchId = new Map<string, Set<(event: WsEnvelope) => void>>();
  public readonly intervalsByMatchId = new Map<string, NodeJS.Timeout>();
  public leaderboard: LeaderboardEntry[] = [];

  subscribe(matchId: string, listener: (event: WsEnvelope) => void): () => void {
    const current = this.wsSubscribersByMatchId.get(matchId) ?? new Set<(event: WsEnvelope) => void>();
    current.add(listener);
    this.wsSubscribersByMatchId.set(matchId, current);

    return () => {
      const listeners = this.wsSubscribersByMatchId.get(matchId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.wsSubscribersByMatchId.delete(matchId);
      }
    };
  }

  publish(matchId: string, message: WsEnvelope): void {
    const listeners = this.wsSubscribersByMatchId.get(matchId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(message);
    }
  }
}

export const store = new InMemoryStore();
