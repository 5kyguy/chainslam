import type { AppConfig } from "../config.js";
import { store } from "../store/in-memory-store.js";
import type { DecisionAction, DecisionEvent, FeedEvent, MatchCreateRequest, MatchState, TradeEvent, WsEnvelope } from "../types.js";
import { SeededRandom } from "../utils/random.js";

const ACTIONS: DecisionAction[] = ["buy", "sell", "hold"];
const REASONS = [
  "Price action confirms trend continuation.",
  "Momentum faded; reducing risk exposure.",
  "Volatility elevated; holding for clearer signal.",
  "Range breakout detected on recent candles.",
  "Mean-reversion trigger fired near intraday extremes."
] as const;

export class SimulationEngine {
  private readonly random: SeededRandom;
  private readonly tickMs: number;

  constructor(private readonly config: AppConfig) {
    this.random = new SeededRandom(config.simSeed);
    this.tickMs = config.simTickMs;
  }

  createMatch(input: MatchCreateRequest): MatchState {
    const now = Date.now();
    const duration = input.durationSeconds ?? 300;
    const capital = input.startingCapitalUsd ?? 1000;
    const id = `match_${Math.floor(this.random.nextInRange(10 ** 7, 10 ** 8 - 1)).toString(36)}`;

    const match: MatchState = {
      id,
      status: "created",
      createdAt: new Date(now).toISOString(),
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + duration * 1000).toISOString(),
      tokenPair: input.tokenPair,
      startingCapitalUsd: capital,
      durationSeconds: duration,
      timeRemainingSeconds: duration,
      ethPrice: 3400,
      contenders: {
        A: { name: input.agentA, pnlPct: 0, portfolioUsd: capital, trades: 0 },
        B: { name: input.agentB, pnlPct: 0, portfolioUsd: capital, trades: 0 }
      }
    };

    store.matchesById.set(id, match);
    store.tradeHistoryByMatchId.set(id, []);
    store.decisionFeedByMatchId.set(id, []);
    this.publishEnvelope(id, "snapshot", match);
    match.status = "running";
    this.startLoop(id);
    this.publishEnvelope(id, "snapshot", match);
    return match;
  }

  stopMatch(id: string): MatchState | undefined {
    const match = store.matchesById.get(id);
    if (!match) {
      return undefined;
    }
    this.stopLoop(id);
    match.status = "stopped";
    match.timeRemainingSeconds = Math.max(0, Math.floor((new Date(match.endsAt).getTime() - Date.now()) / 1000));
    this.publishEnvelope(id, "stopped", match);
    return match;
  }

  private startLoop(matchId: string): void {
    this.stopLoop(matchId);
    const interval = setInterval(() => this.tick(matchId), this.tickMs);
    store.intervalsByMatchId.set(matchId, interval);
  }

  private stopLoop(matchId: string): void {
    const current = store.intervalsByMatchId.get(matchId);
    if (current) {
      clearInterval(current);
      store.intervalsByMatchId.delete(matchId);
    }
  }

  private tick(matchId: string): void {
    const match = store.matchesById.get(matchId);
    if (!match || match.status !== "running") {
      return;
    }

    const now = Date.now();
    const endsAt = new Date(match.endsAt).getTime();
    match.timeRemainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));

    this.updatePricesAndPnl(match);
    const events = this.generateEvents(match);

    for (const event of events) {
      if (event.event === "trade_executed") {
        const trades = store.tradeHistoryByMatchId.get(matchId) ?? [];
        trades.push(event);
        store.tradeHistoryByMatchId.set(matchId, trades);
        this.publishEnvelope(matchId, "trade_executed", event);
      } else {
        const feed = store.decisionFeedByMatchId.get(matchId) ?? [];
        feed.push(event);
        store.decisionFeedByMatchId.set(matchId, feed);
        this.publishEnvelope(matchId, "decision", event);
      }
    }

    this.publishEnvelope(matchId, "snapshot", match);

    if (match.timeRemainingSeconds <= 0) {
      match.status = "completed";
      this.stopLoop(matchId);
      this.publishEnvelope(matchId, "completed", match);
      this.updateLeaderboard(match);
    }
  }

  private updatePricesAndPnl(match: MatchState): void {
    const ethMove = this.random.nextInRange(-8, 8);
    match.ethPrice = Number((match.ethPrice + ethMove).toFixed(2));

    const driftA = this.random.nextInRange(-0.45, 0.55);
    const driftB = this.random.nextInRange(-0.45, 0.55);

    match.contenders.A.pnlPct = Number((match.contenders.A.pnlPct + driftA).toFixed(2));
    match.contenders.B.pnlPct = Number((match.contenders.B.pnlPct + driftB).toFixed(2));
    match.contenders.A.portfolioUsd = Number((match.startingCapitalUsd * (1 + match.contenders.A.pnlPct / 100)).toFixed(2));
    match.contenders.B.portfolioUsd = Number((match.startingCapitalUsd * (1 + match.contenders.B.pnlPct / 100)).toFixed(2));
  }

  private generateEvents(match: MatchState): FeedEvent[] {
    const contenders: Array<"A" | "B"> = ["A", "B"];
    const events: FeedEvent[] = [];

    for (const side of contenders) {
      const contender = match.contenders[side];
      const action = this.random.pick(ACTIONS);
      const amount = Number(this.random.nextInRange(30, 220).toFixed(2));
      const decision: DecisionEvent = {
        event: "decision",
        contender: contender.name,
        action,
        amount,
        reasoning: this.random.pick(REASONS),
        confidence: Number(this.random.nextInRange(0.5, 0.95).toFixed(2)),
        timestamp: new Date().toISOString()
      };
      events.push(decision);

      if (action !== "hold") {
        contender.trades += 1;
        const [base, quote] = match.tokenPair.split("/");
        const trade: TradeEvent = {
          event: "trade_executed",
          contender: contender.name,
          txHash: `0x${Math.floor(this.random.nextInRange(10 ** 11, 10 ** 12 - 1)).toString(16)}${Date.now().toString(16)}`,
          sold: action === "buy" ? { token: quote ?? "USDC", amount } : { token: base ?? "WETH", amount: Number((amount / 3400).toFixed(6)) },
          bought:
            action === "buy"
              ? { token: base ?? "WETH", amount: Number((amount / match.ethPrice).toFixed(6)) }
              : { token: quote ?? "USDC", amount },
          gasUsd: Number(this.random.nextInRange(0.8, 2.3).toFixed(2)),
          timestamp: new Date().toISOString()
        };
        events.push(trade);
      }
    }
    return events;
  }

  private publishEnvelope(matchId: string, eventType: WsEnvelope["event"], payload: unknown): void {
    const envelope: WsEnvelope = {
      event: eventType,
      match_id: matchId,
      timestamp: new Date().toISOString(),
      payload
    };
    store.publish(matchId, envelope);
  }

  private updateLeaderboard(match: MatchState): void {
    const entries = [match.contenders.A, match.contenders.B].map((contender) => ({
      strategy: contender.name,
      pnl: contender.pnlPct
    }));
    entries.sort((a, b) => b.pnl - a.pnl);

    store.leaderboard = entries.map((entry, index) => ({
      rank: index + 1,
      strategy: entry.strategy,
      rating: 1200 + Math.round(entry.pnl * 8),
      wins: index === 0 ? 1 : 0,
      losses: index === 0 ? 0 : 1,
      draws: 0,
      avgPnlPct: Number(entry.pnl.toFixed(2)),
      matchesPlayed: 1
    }));
  }
}
