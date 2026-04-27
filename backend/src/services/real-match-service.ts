import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AgentRuntime } from "../agents/agent-runtime.js";
import { store } from "../store/in-memory-store.js";
import { STRATEGIES } from "./strategy-catalog.js";
import type { AgentService } from "./agent-service.js";
import type { MatchService } from "./match-service.js";
import type {
  ContenderState,
  DecisionEvent,
  FeedEvent,
  MatchCreateRequest,
  MatchState,
  StrategySignal,
  TickContext,
  TradeEvent,
  WsEnvelope,
} from "../types.js";

interface ContenderRuntime {
  agentId: string;
  name: string;
  runtime: AgentRuntime;
  usdcBalance: number;
  ethBalance: number;
  tradeCount: number;
}

const TICK_MS = 10_000;
const INITIAL_ETH_PRICE = 3400;

export class RealMatchService implements MatchService {
  private readonly runtimes = new Map<string, { a: ContenderRuntime; b: ContenderRuntime }>();
  private readonly priceHistories = new Map<string, number[]>();
  private readonly tickNumbers = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly agentService: AgentService,
  ) {}

  createMatch(input: MatchCreateRequest): MatchState {
    const agentA = this.agentService.get(input.agentA);
    const agentB = this.agentService.get(input.agentB);

    if (!agentA || agentA.status !== "ready") {
      throw new Error(`Agent A "${input.agentA}" not found or not available (status: ${agentA?.status ?? "missing"})`);
    }
    if (!agentB || agentB.status !== "ready") {
      throw new Error(`Agent B "${input.agentB}" not found or not available (status: ${agentB?.status ?? "missing"})`);
    }

    const now = Date.now();
    const duration = input.durationSeconds ?? 300;
    const capital = input.startingCapitalUsd ?? 1000;
    const id = `match_${randomUUID().slice(0, 8)}`;

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
      ethPrice: INITIAL_ETH_PRICE,
      contenders: {
        A: { name: agentA.name, pnlPct: 0, portfolioUsd: capital, trades: 0 },
        B: { name: agentB.name, pnlPct: 0, portfolioUsd: capital, trades: 0 },
      },
    };

    this.runtimes.set(id, {
      a: {
        agentId: agentA.id,
        name: agentA.name,
        runtime: new AgentRuntime(this.config, agentA.name, agentA.prompt),
        usdcBalance: capital,
        ethBalance: 0,
        tradeCount: 0,
      },
      b: {
        agentId: agentB.id,
        name: agentB.name,
        runtime: new AgentRuntime(this.config, agentB.name, agentB.prompt),
        usdcBalance: capital,
        ethBalance: 0,
        tradeCount: 0,
      },
    });

    this.priceHistories.set(id, [INITIAL_ETH_PRICE]);
    this.tickNumbers.set(id, 0);

    this.agentService.setStatus(agentA.id, "in_match");
    this.agentService.setStatus(agentB.id, "in_match");

    store.matchesById.set(id, match);
    store.tradeHistoryByMatchId.set(id, []);
    store.decisionFeedByMatchId.set(id, []);

    match.status = "running";
    this.publishEnvelope(id, "snapshot", match);
    this.startLoop(id);
    return match;
  }

  getMatch(id: string): MatchState | undefined {
    return store.matchesById.get(id);
  }

  getTrades(id: string): unknown[] {
    return store.tradeHistoryByMatchId.get(id) ?? [];
  }

  getFeed(id: string): unknown[] {
    return store.decisionFeedByMatchId.get(id) ?? [];
  }

  stopMatch(id: string): MatchState | undefined {
    const match = store.matchesById.get(id);
    if (!match) return undefined;

    this.stopLoop(id);
    match.status = "stopped";
    match.timeRemainingSeconds = Math.max(0, Math.floor((new Date(match.endsAt).getTime() - Date.now()) / 1000));
    this.releaseAgents(id);
    this.publishEnvelope(id, "stopped", match);
    return match;
  }

  getStrategies() {
    return STRATEGIES;
  }

  getLeaderboard() {
    return store.leaderboard;
  }

  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void {
    const match = this.getMatch(matchId);
    if (match) {
      send({ event: "snapshot", match_id: matchId, timestamp: new Date().toISOString(), payload: match });
    }
    return store.subscribe(matchId, send);
  }

  private startLoop(matchId: string): void {
    this.stopLoop(matchId);
    const interval = setInterval(() => void this.tick(matchId), TICK_MS);
    store.intervalsByMatchId.set(matchId, interval);
  }

  private stopLoop(matchId: string): void {
    const current = store.intervalsByMatchId.get(matchId);
    if (current) {
      clearInterval(current);
      store.intervalsByMatchId.delete(matchId);
    }
  }

  private async tick(matchId: string): Promise<void> {
    const match = store.matchesById.get(matchId);
    const pair = this.runtimes.get(matchId);
    if (!match || match.status !== "running" || !pair) return;

    const now = Date.now();
    const endsAt = new Date(match.endsAt).getTime();
    match.timeRemainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));

    const tickNum = (this.tickNumbers.get(matchId) ?? 0) + 1;
    this.tickNumbers.set(matchId, tickNum);

    const totalTicks = Math.ceil(match.durationSeconds / (TICK_MS / 1000));
    const priceHistory = this.priceHistories.get(matchId) ?? [];
    const currentPrice = priceHistory[priceHistory.length - 1] ?? INITIAL_ETH_PRICE;

    await this.evaluateContender(matchId, match, pair.a, "A", currentPrice, priceHistory, tickNum, totalTicks);
    await this.evaluateContender(matchId, match, pair.b, "B", currentPrice, priceHistory, tickNum, totalTicks);

    const newPrice = this.simulatePriceMove(currentPrice);
    priceHistory.push(newPrice);
    match.ethPrice = newPrice;

    this.recalcPortfolios(match, pair);

    this.publishEnvelope(matchId, "snapshot", match);

    if (match.timeRemainingSeconds <= 0) {
      match.status = "completed";
      this.stopLoop(matchId);
      this.releaseAgents(matchId);
      this.publishEnvelope(matchId, "completed", match);
      this.updateStatsAndLeaderboard(match, pair);
    }
  }

  private async evaluateContender(
    matchId: string,
    match: MatchState,
    contender: ContenderRuntime,
    side: "A" | "B",
    currentPrice: number,
    priceHistory: number[],
    tickNumber: number,
    totalTicks: number,
  ): Promise<void> {
    const contenderState = match.contenders[side];
    const ctx: TickContext = {
      tokenPair: match.tokenPair,
      ethPrice: currentPrice,
      priceHistory,
      usdcBalance: contender.usdcBalance,
      ethBalance: contender.ethBalance,
      portfolioUsd: contenderState.portfolioUsd,
      pnlPct: contenderState.pnlPct,
      tradeCount: contender.tradeCount,
      tickNumber,
      ticksRemaining: Math.max(0, totalTicks - tickNumber),
    };

    let signal: StrategySignal;
    try {
      signal = await contender.runtime.evaluate(ctx);
    } catch (err) {
      console.error(`[${contender.name}] evaluate failed:`, err);
      signal = { action: "hold", amount: 0, reasoning: "Runtime error, defaulting to hold.", confidence: 0 };
    }

    const decision: DecisionEvent = {
      event: "decision",
      contender: contender.name,
      action: signal.action,
      amount: signal.amount,
      reasoning: signal.reasoning,
      confidence: signal.confidence,
      timestamp: new Date().toISOString(),
    };

    const feed = store.decisionFeedByMatchId.get(matchId) ?? [];
    feed.push(decision);
    store.decisionFeedByMatchId.set(matchId, feed);
    this.publishEnvelope(matchId, "decision", decision);

    if (signal.action !== "hold") {
      this.applyTrade(matchId, match, contender, contenderState, signal, currentPrice);
    }
  }

  private applyTrade(
    matchId: string,
    match: MatchState,
    contender: ContenderRuntime,
    state: ContenderState,
    signal: StrategySignal,
    currentPrice: number,
  ): void {
    const [base, quote] = match.tokenPair.split("/");
    const baseToken = base ?? "WETH";
    const quoteToken = quote ?? "USDC";
    const maxTradeUsd = match.startingCapitalUsd * 0.5;

    if (signal.action === "buy") {
      let amountUsd = Math.min(signal.amount, contender.usdcBalance, maxTradeUsd);
      if (amountUsd < 10) return;

      const ethBought = amountUsd / currentPrice;
      contender.usdcBalance -= amountUsd;
      contender.ethBalance += ethBought;
      contender.tradeCount += 1;
      state.trades += 1;

      const trade: TradeEvent = {
        event: "trade_executed",
        contender: contender.name,
        txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
        sold: { token: quoteToken, amount: Number(amountUsd.toFixed(2)) },
        bought: { token: baseToken, amount: Number(ethBought.toFixed(6)) },
        gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
        timestamp: new Date().toISOString(),
      };

      const trades = store.tradeHistoryByMatchId.get(matchId) ?? [];
      trades.push(trade);
      store.tradeHistoryByMatchId.set(matchId, trades);
      this.publishEnvelope(matchId, "trade_executed", trade);
    }

    if (signal.action === "sell") {
      let amountEth = Math.min(signal.amount, contender.ethBalance);
      if (amountEth < 10 / currentPrice) return;

      const amountUsd = amountEth * currentPrice;
      if (amountUsd > maxTradeUsd) {
        amountEth = maxTradeUsd / currentPrice;
      }

      contender.ethBalance -= amountEth;
      contender.usdcBalance += amountEth * currentPrice;
      contender.tradeCount += 1;
      state.trades += 1;

      const trade: TradeEvent = {
        event: "trade_executed",
        contender: contender.name,
        txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
        sold: { token: baseToken, amount: Number(amountEth.toFixed(6)) },
        bought: { token: quoteToken, amount: Number((amountEth * currentPrice).toFixed(2)) },
        gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
        timestamp: new Date().toISOString(),
      };

      const trades = store.tradeHistoryByMatchId.get(matchId) ?? [];
      trades.push(trade);
      store.tradeHistoryByMatchId.set(matchId, trades);
      this.publishEnvelope(matchId, "trade_executed", trade);
    }
  }

  private recalcPortfolios(match: MatchState, pair: { a: ContenderRuntime; b: ContenderRuntime }): void {
    const price = match.ethPrice;
    match.contenders.A.portfolioUsd = Number((pair.a.usdcBalance + pair.a.ethBalance * price).toFixed(2));
    match.contenders.B.portfolioUsd = Number((pair.b.usdcBalance + pair.b.ethBalance * price).toFixed(2));
    match.contenders.A.pnlPct = Number(((match.contenders.A.portfolioUsd / match.startingCapitalUsd - 1) * 100).toFixed(2));
    match.contenders.B.pnlPct = Number(((match.contenders.B.portfolioUsd / match.startingCapitalUsd - 1) * 100).toFixed(2));
  }

  private simulatePriceMove(currentPrice: number): number {
    const change = (Math.random() - 0.5) * 16;
    return Number((currentPrice + change).toFixed(2));
  }

  private releaseAgents(matchId: string): void {
    const pair = this.runtimes.get(matchId);
    if (pair) {
      this.agentService.setStatus(pair.a.agentId, "ready");
      this.agentService.setStatus(pair.b.agentId, "ready");
    }
  }

  private updateStatsAndLeaderboard(match: MatchState, pair: { a: ContenderRuntime; b: ContenderRuntime }): void {
    const pnlA = match.contenders.A.pnlPct;
    const pnlB = match.contenders.B.pnlPct;
    const drawThreshold = 0.25;

    let resultA: "win" | "loss" | "draw";
    let resultB: "win" | "loss" | "draw";

    if (Math.abs(pnlA - pnlB) < drawThreshold) {
      resultA = "draw";
      resultB = "draw";
    } else if (pnlA > pnlB) {
      resultA = "win";
      resultB = "loss";
    } else {
      resultA = "loss";
      resultB = "win";
    }

    this.agentService.updateStats(pair.a.agentId, resultA, pnlA);
    this.agentService.updateStats(pair.b.agentId, resultB, pnlB);

    this.updateLeaderboard();
  }

  private updateLeaderboard(): void {
    const agents = this.agentService.list()
      .filter((a) => a.stats.matchesPlayed > 0)
      .sort((a, b) => b.stats.rating - a.stats.rating);

    store.leaderboard = agents.map((agent, index) => ({
      rank: index + 1,
      strategy: agent.name,
      rating: agent.stats.rating,
      wins: agent.stats.wins,
      losses: agent.stats.losses,
      draws: agent.stats.draws,
      avgPnlPct: agent.stats.avgPnlPct,
      matchesPlayed: agent.stats.matchesPlayed,
    }));
  }

  private publishEnvelope(matchId: string, eventType: WsEnvelope["event"], payload: unknown): void {
    const envelope: WsEnvelope = { event: eventType, match_id: matchId, timestamp: new Date().toISOString(), payload };
    store.publish(matchId, envelope);
  }
}
