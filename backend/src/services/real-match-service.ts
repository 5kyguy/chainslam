import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { STRATEGIES } from "./strategy-catalog.js";
import type { AgentService } from "./agent-service.js";
import type { MatchService } from "./match-service.js";
import type { Store } from "../store/store.js";
import type { AgentProcessManager, ManagedAgent } from "../agents/process-manager.js";
import type { UniswapClient } from "../integrations/uniswap.js";
import { fromBaseUnits, tokenDecimals, toBaseUnits } from "../integrations/tokens.js";
import type {
  ContenderState,
  DecisionEvent,
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
  strategy: string;
  managed: ManagedAgent;
  usdcBalance: number;
  ethBalance: number;
  tradeCount: number;
}

const TICK_MS = 10_000;
const FALLBACK_INITIAL_PRICE = 3400;
const AGENT_CONNECT_WAIT_MS = 3_000;

export class RealMatchService implements MatchService {
  private readonly runtimes = new Map<string, { a: ContenderRuntime; b: ContenderRuntime }>();
  private readonly priceHistories = new Map<string, number[]>();
  private readonly tickNumbers = new Map<string, number>();
  private warnedLiveSwapMode = false;

  constructor(
    private readonly config: AppConfig,
    private readonly agentService: AgentService,
    private readonly store: Store,
    private readonly processManager: AgentProcessManager,
    private readonly uniswap?: UniswapClient,
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
    const initialPrice = this.lastKnownPrice ?? FALLBACK_INITIAL_PRICE;

    const managedA = this.processManager.spawn(agentA.id, agentA.strategy);
    const managedB = this.processManager.spawn(agentB.id, agentB.strategy);

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
      ethPrice: initialPrice,
      contenders: {
        A: { name: agentA.name, pnlPct: 0, portfolioUsd: capital, trades: 0 },
        B: { name: agentB.name, pnlPct: 0, portfolioUsd: capital, trades: 0 },
      },
    };

    this.runtimes.set(id, {
      a: { agentId: agentA.id, name: agentA.name, strategy: agentA.strategy, managed: managedA, usdcBalance: capital, ethBalance: 0, tradeCount: 0 },
      b: { agentId: agentB.id, name: agentB.name, strategy: agentB.strategy, managed: managedB, usdcBalance: capital, ethBalance: 0, tradeCount: 0 },
    });

    this.priceHistories.set(id, [initialPrice]);
    this.tickNumbers.set(id, 0);

    this.agentService.setStatus(agentA.id, "in_match");
    this.agentService.setStatus(agentB.id, "in_match");

    this.store.saveMatch(match);
    match.status = "running";
    this.store.updateMatch(match);
    this.publishEnvelope(id, "snapshot", match);

    setTimeout(() => this.startLoop(id), AGENT_CONNECT_WAIT_MS);
    return match;
  }

  getMatch(id: string): MatchState | undefined {
    return this.store.getMatch(id);
  }

  getTrades(id: string): unknown[] {
    return this.store.getTrades(id);
  }

  getFeed(id: string): unknown[] {
    return this.store.getFeed(id);
  }

  stopMatch(id: string): MatchState | undefined {
    const match = this.store.getMatch(id);
    if (!match) return undefined;

    this.stopLoop(id);
    match.status = "stopped";
    match.timeRemainingSeconds = Math.max(0, Math.floor((new Date(match.endsAt).getTime() - Date.now()) / 1000));
    this.store.updateMatch(match);
    this.killAgents(id);
    this.publishEnvelope(id, "stopped", match);
    return match;
  }

  getStrategies() {
    return STRATEGIES;
  }

  getLeaderboard() {
    return this.store.getLeaderboard();
  }

  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void {
    const match = this.getMatch(matchId);
    if (match) {
      send({ event: "snapshot", match_id: matchId, timestamp: new Date().toISOString(), payload: match });
    }
    return this.store.subscribe(matchId, send);
  }

  private startLoop(matchId: string): void {
    this.stopLoop(matchId);
    const interval = setInterval(() => void this.tick(matchId), TICK_MS);
    this.store.setInterval(matchId, interval);
  }

  private stopLoop(matchId: string): void {
    const current = this.store.getInterval(matchId);
    if (current) {
      clearInterval(current);
      this.store.deleteInterval(matchId);
    }
  }

  private lastKnownPrice: number | null = null;

  private async tick(matchId: string): Promise<void> {
    const match = this.store.getMatch(matchId);
    const pair = this.runtimes.get(matchId);
    if (!match || match.status !== "running" || !pair) return;

    const now = Date.now();
    const endsAt = new Date(match.endsAt).getTime();
    match.timeRemainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));

    const tickNum = (this.tickNumbers.get(matchId) ?? 0) + 1;
    this.tickNumbers.set(matchId, tickNum);

    const totalTicks = Math.ceil(match.durationSeconds / (TICK_MS / 1000));
    const priceHistory = this.priceHistories.get(matchId) ?? [];
    const currentPrice = priceHistory[priceHistory.length - 1] ?? FALLBACK_INITIAL_PRICE;

    const [sigA, sigB] = await Promise.all([
      this.evaluateContender(matchId, match, pair.a, "A", currentPrice, priceHistory, tickNum, totalTicks),
      this.evaluateContender(matchId, match, pair.b, "B", currentPrice, priceHistory, tickNum, totalTicks),
    ]);

    await this.applyDecision(matchId, match, pair.a, match.contenders.A, sigA, currentPrice);
    await this.applyDecision(matchId, match, pair.b, match.contenders.B, sigB, currentPrice);

    const newPrice = await this.fetchPrice(currentPrice, match.tokenPair);
    priceHistory.push(newPrice);
    match.ethPrice = newPrice;
    this.lastKnownPrice = newPrice;

    this.recalcPortfolios(match, pair);
    this.store.updateMatch(match);
    this.publishEnvelope(matchId, "snapshot", match);

    if (match.timeRemainingSeconds <= 0) {
      match.status = "completed";
      this.stopLoop(matchId);
      this.store.updateMatch(match);
      this.killAgents(matchId);
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
  ): Promise<StrategySignal> {
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
      signal = await contender.managed.connection.evaluate(ctx);
    } catch (err) {
      console.error(`[${contender.name}] remote evaluate failed:`, err);
      signal = { action: "hold", amount: 0, reasoning: "Remote agent error, defaulting to hold.", confidence: 0 };
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

    this.store.addDecision(matchId, decision);
    this.publishEnvelope(matchId, "decision", decision);
    return signal;
  }

  private async applyDecision(
    matchId: string,
    match: MatchState,
    contender: ContenderRuntime,
    state: ContenderState,
    signal: StrategySignal,
    currentPrice: number,
  ): Promise<void> {
    if (signal.action === "hold") return;

    if (this.config.uniswap.swapMode === "live" && !this.warnedLiveSwapMode) {
      console.warn(
        "[RealMatchService] UNISWAP_SWAP_MODE=live: POST /swap is not wired yet; trades still use real quotes + mock swap metadata only (no on-chain swap).",
      );
      this.warnedLiveSwapMode = true;
    }

    const [base, quote] = match.tokenPair.split("/");
    const baseToken = base ?? "WETH";
    const quoteToken = quote ?? "USDC";
    const maxTradeUsd = match.startingCapitalUsd * 0.5;

    const handled = await this.tryApplyDecisionWithUniswapQuotes(
      matchId,
      contender,
      state,
      signal,
      currentPrice,
      baseToken,
      quoteToken,
      maxTradeUsd,
    );
    if (handled) return;

    this.applyDecisionPaper(matchId, contender, state, signal, currentPrice, baseToken, quoteToken, maxTradeUsd);
  }

  /**
   * Real `/quote` route sizes + `/check_approval`; mock swap metadata only (never POST /swap).
   */
  private async tryApplyDecisionWithUniswapQuotes(
    matchId: string,
    contender: ContenderRuntime,
    state: ContenderState,
    signal: StrategySignal,
    currentPrice: number,
    baseToken: string,
    quoteToken: string,
    maxTradeUsd: number,
  ): Promise<boolean> {
    if (!this.uniswap || !this.config.uniswap.execution) {
      return false;
    }

    try {
      if (signal.action === "buy") {
        let amountUsd = Math.min(signal.amount, contender.usdcBalance, maxTradeUsd);
        if (amountUsd < 10) return true;

        const quoteDecimals = tokenDecimals(quoteToken);
        const amountInBaseUnits = (BigInt(Math.round(amountUsd * 10 ** quoteDecimals))).toString();

        const q = await this.uniswap.getExactInputQuote({
          tokenInSymbol: quoteToken,
          tokenOutSymbol: baseToken,
          amountInBaseUnits,
        });

        let approvalRequestId: string | undefined;
        try {
          const appr = await this.uniswap.checkApproval({
            tokenInSymbolOrAddress: quoteToken,
            amountBaseUnits: amountInBaseUnits,
          });
          approvalRequestId = appr.requestId;
        } catch (apErr) {
          console.error("[Uniswap] check_approval failed (continuing with quote fill):", apErr);
        }

        const mockBuild = this.uniswap.buildMockSwapBuild(q.raw);

        const debitQuote = fromBaseUnits(q.amountIn, quoteDecimals);
        const creditBase = fromBaseUnits(q.amountOut, tokenDecimals(baseToken));

        contender.usdcBalance -= debitQuote;
        contender.ethBalance += creditBase;
        contender.tradeCount += 1;
        state.trades += 1;

        const trade: TradeEvent = {
          event: "trade_executed",
          contender: contender.name,
          txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
          sold: { token: quoteToken, amount: Number(debitQuote.toFixed(quoteDecimals <= 9 ? 6 : 8)) },
          bought: { token: baseToken, amount: Number(creditBase.toFixed(tokenDecimals(baseToken) <= 9 ? 6 : 8)) },
          gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
          timestamp: new Date().toISOString(),
          executionMode: "uniswap_quote_mock",
          quoteRouting: q.routing,
          mockSwapBuild: mockBuild,
          approvalRequestId,
        };

        this.store.addTrade(matchId, trade);
        this.publishEnvelope(matchId, "trade_executed", trade);
        return true;
      }

      if (signal.action === "sell") {
        let amountBase = Math.min(signal.amount, contender.ethBalance);
        if (amountBase < 10 / currentPrice) return true;

        let amountUsd = amountBase * currentPrice;
        if (amountUsd > maxTradeUsd) {
          amountBase = maxTradeUsd / currentPrice;
          amountUsd = amountBase * currentPrice;
        }

        const baseDecimals = tokenDecimals(baseToken);
        const amountInBaseUnits = toBaseUnits(amountBase, baseDecimals);

        const q = await this.uniswap.getExactInputQuote({
          tokenInSymbol: baseToken,
          tokenOutSymbol: quoteToken,
          amountInBaseUnits,
        });

        let approvalRequestId: string | undefined;
        try {
          const appr = await this.uniswap.checkApproval({
            tokenInSymbolOrAddress: baseToken,
            amountBaseUnits: amountInBaseUnits,
          });
          approvalRequestId = appr.requestId;
        } catch (apErr) {
          console.error("[Uniswap] check_approval failed (continuing with quote fill):", apErr);
        }

        const mockBuild = this.uniswap.buildMockSwapBuild(q.raw);

        const soldBase = fromBaseUnits(q.amountIn, baseDecimals);
        const boughtQuote = fromBaseUnits(q.amountOut, tokenDecimals(quoteToken));

        contender.ethBalance -= soldBase;
        contender.usdcBalance += boughtQuote;
        contender.tradeCount += 1;
        state.trades += 1;

        const trade: TradeEvent = {
          event: "trade_executed",
          contender: contender.name,
          txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
          sold: { token: baseToken, amount: Number(soldBase.toFixed(tokenDecimals(baseToken) <= 9 ? 6 : 8)) },
          bought: { token: quoteToken, amount: Number(boughtQuote.toFixed(6)) },
          gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
          timestamp: new Date().toISOString(),
          executionMode: "uniswap_quote_mock",
          quoteRouting: q.routing,
          mockSwapBuild: mockBuild,
          approvalRequestId,
        };

        this.store.addTrade(matchId, trade);
        this.publishEnvelope(matchId, "trade_executed", trade);
        return true;
      }

      return false;
    } catch (err) {
      console.error("[Uniswap] quote/approval path failed; falling back to paper math:", err);
      return false;
    }
  }

  /** Price-oracle style paper amounts (legacy). */
  private applyDecisionPaper(
    matchId: string,
    contender: ContenderRuntime,
    state: ContenderState,
    signal: StrategySignal,
    currentPrice: number,
    baseToken: string,
    quoteToken: string,
    maxTradeUsd: number,
  ): void {
    if (signal.action === "buy") {
      let amountUsd = Math.min(signal.amount, contender.usdcBalance, maxTradeUsd);
      if (amountUsd < 10) return;

      const ethBought = amountUsd / currentPrice;
      contender.usdcBalance -= amountUsd;
      contender.ethBalance += ethBought;
      contender.tradeCount += 1;
      state.trades += 1;

      const trade: TradeEvent = {
        event: "trade_executed", contender: contender.name,
        txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
        sold: { token: quoteToken, amount: Number(amountUsd.toFixed(2)) },
        bought: { token: baseToken, amount: Number(ethBought.toFixed(6)) },
        gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
        timestamp: new Date().toISOString(),
        executionMode: "paper",
      };

      this.store.addTrade(matchId, trade);
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
        event: "trade_executed", contender: contender.name,
        txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
        sold: { token: baseToken, amount: Number(amountEth.toFixed(6)) },
        bought: { token: quoteToken, amount: Number((amountEth * currentPrice).toFixed(2)) },
        gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
        timestamp: new Date().toISOString(),
        executionMode: "paper",
      };

      this.store.addTrade(matchId, trade);
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

  private async fetchPrice(fallbackPrice: number, tokenPair: string): Promise<number> {
    if (!this.uniswap) {
      return this.simulatePriceMove(fallbackPrice);
    }

    try {
      const [base, quote] = tokenPair.split("/");
      const result = await this.uniswap.getPrice(quote ?? "USDC", base ?? "WETH");
      if (result.price > 0 && Number.isFinite(result.price)) {
        return Number(result.price.toFixed(2));
      }
    } catch (err) {
      console.error("[UniswapClient] price fetch failed, using fallback:", err);
    }

    return this.simulatePriceMove(fallbackPrice);
  }

  private simulatePriceMove(currentPrice: number): number {
    const change = (Math.random() - 0.5) * 16;
    return Number((currentPrice + change).toFixed(2));
  }

  private killAgents(matchId: string): void {
    const pair = this.runtimes.get(matchId);
    if (pair) {
      this.processManager.kill(pair.a.agentId);
      this.processManager.kill(pair.b.agentId);
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

    this.store.setLeaderboard(agents.map((agent, index) => ({
      rank: index + 1,
      strategy: agent.name,
      rating: agent.stats.rating,
      wins: agent.stats.wins,
      losses: agent.stats.losses,
      draws: agent.stats.draws,
      avgPnlPct: agent.stats.avgPnlPct,
      matchesPlayed: agent.stats.matchesPlayed,
    })));
  }

  private publishEnvelope(matchId: string, eventType: WsEnvelope["event"], payload: unknown): void {
    const envelope: WsEnvelope = { event: eventType, match_id: matchId, timestamp: new Date().toISOString(), payload };
    this.store.publish(matchId, envelope);
  }
}
