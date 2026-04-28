import { STRATEGIES } from "./strategy-catalog.js";
import type { AppConfig } from "../config.js";
import { SimulationEngine } from "./simulation-engine.js";
import type { MatchService } from "./match-service.js";
import { store } from "../store/in-memory-store.js";
import type { MatchCreateRequest } from "../types.js";

export class DummyMatchService implements MatchService {
  private readonly engine: SimulationEngine;

  constructor(config: AppConfig) {
    this.engine = new SimulationEngine(config);
  }

  createMatch(input: MatchCreateRequest) {
    return this.engine.createMatch(input);
  }

  getMatch(id: string) {
    return store.matchesById.get(id);
  }

  getTrades(id: string) {
    return store.tradeHistoryByMatchId.get(id) ?? [];
  }

  getExecutions(id: string) {
    return this.getTrades(id);
  }

  getFeed(id: string) {
    return store.decisionFeedByMatchId.get(id) ?? [];
  }

  stopMatch(id: string) {
    return this.engine.stopMatch(id);
  }

  getStrategies() {
    return STRATEGIES;
  }

  getLeaderboard() {
    if (store.leaderboard.length > 0) {
      return store.leaderboard;
    }
    return [
      {
        rank: 1,
        strategy: "Momentum Trader",
        rating: 1236,
        wins: 8,
        losses: 3,
        draws: 1,
        avgPnlPct: 4.22,
        matchesPlayed: 12
      },
      {
        rank: 2,
        strategy: "DCA Bot",
        rating: 1210,
        wins: 7,
        losses: 4,
        draws: 1,
        avgPnlPct: 3.18,
        matchesPlayed: 12
      }
    ];
  }

  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void {
    const match = this.getMatch(matchId);
    if (match) {
      send({
        event: "snapshot",
        match_id: matchId,
        timestamp: new Date().toISOString(),
        payload: match
      });
    }
    return store.subscribe(matchId, send);
  }
}
