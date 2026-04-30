import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { STRATEGIES } from "./strategy-catalog.js";
import type { AgentService } from "./agent-service.js";
import type { MatchService } from "./match-service.js";
import type { Store } from "../store/store.js";
import type { AgentProcessManager, ManagedAgent } from "../agents/process-manager.js";
import {
  gasUsdFromQuoteResponse,
  type UniswapClient,
  type UniswapQuoteResponse,
} from "../integrations/uniswap.js";
import { normalizeKeeperHubStatus, type KeeperHubClient } from "../integrations/keeperhub.js";
import { type Permit2Signer } from "../integrations/permit2-signer.js";
import { KeeperHubExecutionPoller } from "./keeperhub-execution-poller.js";
import { fromBaseUnits, tokenDecimals, toBaseUnits } from "../integrations/tokens.js";
import type {
  ContenderState,
  DecisionEvent,
  KeeperHubExecutionAudit,
  MatchCreateRequest,
  MatchState,
  StrategySignal,
  TickContext,
  TradeEvent,
  WsEnvelope,
} from "../types.js";
import type { MatchListFilter } from "../store/store.js";
import { computeMatchOutcome } from "./match-outcome.js";
import type { MemoryPage, MemoryQuery, ZeroGMemoryService } from "./zerog-memory-service.js";
import { clampMaxTradeUsd, pnlPctFromPortfolio } from "./trading-policy.js";

interface ContenderRuntime {
  agentId: string;
  name: string;
  strategy: string;
  managed: ManagedAgent;
  /** Initial USDC bankroll for sizing and PnL (matches ContenderState.startingCapitalUsd). */
  startingCapitalUsd: number;
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

  constructor(
    private readonly config: AppConfig,
    private readonly agentService: AgentService,
    private readonly store: Store,
    private readonly processManager: AgentProcessManager,
    private readonly uniswap: UniswapClient,
    private readonly keeperHub?: KeeperHubClient,
    private readonly keeperHubPoller?: KeeperHubExecutionPoller,
    private readonly zeroGMemory?: ZeroGMemoryService,
    private readonly permit2Signer?: Permit2Signer,
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
    const { capitalA, capitalB } = this.resolveStartingCapitals(input);
    const aggregateCapitalUsd = Math.max(capitalA, capitalB);
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
      startingCapitalUsd: aggregateCapitalUsd,
      durationSeconds: duration,
      timeRemainingSeconds: duration,
      ethPrice: initialPrice,
      contenders: {
        A: { name: agentA.name, startingCapitalUsd: capitalA, pnlPct: 0, portfolioUsd: capitalA, trades: 0 },
        B: { name: agentB.name, startingCapitalUsd: capitalB, pnlPct: 0, portfolioUsd: capitalB, trades: 0 },
      },
    };

    this.runtimes.set(id, {
      a: {
        agentId: agentA.id,
        name: agentA.name,
        strategy: agentA.strategy,
        managed: managedA,
        startingCapitalUsd: capitalA,
        usdcBalance: capitalA,
        ethBalance: 0,
        tradeCount: 0,
      },
      b: {
        agentId: agentB.id,
        name: agentB.name,
        strategy: agentB.strategy,
        managed: managedB,
        startingCapitalUsd: capitalB,
        usdcBalance: capitalB,
        ethBalance: 0,
        tradeCount: 0,
      },
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

    this.zeroGMemory?.recordMatchStarted({
      matchId: id,
      tokenPair: input.tokenPair,
      startingCapitalUsd: aggregateCapitalUsd,
      startingCapitalUsdA: capitalA,
      startingCapitalUsdB: capitalB,
      durationSeconds: duration,
      contenderA: { agentId: agentA.id, name: agentA.name, strategy: agentA.strategy },
      contenderB: { agentId: agentB.id, name: agentB.name, strategy: agentB.strategy },
    });

    return match;
  }

  private resolveStartingCapitals(input: MatchCreateRequest): { capitalA: number; capitalB: number } {
    const hasA = input.startingCapitalUsdA !== undefined;
    const hasB = input.startingCapitalUsdB !== undefined;
    if (hasA !== hasB) {
      throw new Error("startingCapitalUsdA and startingCapitalUsdB must both be provided or both omitted.");
    }
    if (hasA && hasB) {
      if (input.startingCapitalUsdA! < 1 || input.startingCapitalUsdB! < 1) {
        throw new Error("Per-agent starting capital must be at least 1 USD.");
      }
      return { capitalA: input.startingCapitalUsdA!, capitalB: input.startingCapitalUsdB! };
    }
    const shared = input.startingCapitalUsd ?? this.config.trading.defaultPerAgentStartingCapitalUsd;
    if (shared < 1) {
      throw new Error("startingCapitalUsd must be at least 1 USD.");
    }
    return { capitalA: shared, capitalB: shared };
  }

  getMatch(id: string): MatchState | undefined {
    return this.store.getMatch(id);
  }

  listMatches(filter?: MatchListFilter): MatchState[] {
    return this.store.listMatches(filter);
  }

  getTrades(id: string): unknown[] {
    return this.store.getTrades(id);
  }

  getKeeperHubExecutions(id: string): KeeperHubExecutionAudit[] {
    return this.store.getTrades(id)
      .filter((trade) =>
        trade.executionMode === "uniswap_live_swap" ||
        trade.keeperhubSubmissionId !== undefined ||
        trade.keeperhubStatus !== undefined ||
        trade.lastExecutionError !== undefined,
      )
      .map((trade) => ({
        tradeRecordId: trade.tradeRecordId ?? "",
        contender: trade.contender,
        timestamp: trade.timestamp,
        executionMode: trade.executionMode,
        sold: trade.sold,
        bought: trade.bought,
        keeperhubSubmissionId: trade.keeperhubSubmissionId,
        keeperhubStatus: trade.keeperhubStatus,
        keeperhubRetryCount: trade.keeperhubRetryCount,
        onChainTxHash: trade.onChainTxHash,
        keeperhubTransactionLink: trade.keeperhubTransactionLink,
        lastExecutionError: trade.lastExecutionError,
        executionReceipt: trade.executionReceipt,
      }));
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
    const pair = this.runtimes.get(id);
    if (pair) {
      const oc = computeMatchOutcome(match);
      this.zeroGMemory?.recordMatchStopped({
        matchId: id,
        status: "stopped",
        contenders: {
          A: { agentId: pair.a.agentId, name: pair.a.name, pnlPct: match.contenders.A.pnlPct, portfolioUsd: match.contenders.A.portfolioUsd },
          B: { agentId: pair.b.agentId, name: pair.b.name, pnlPct: match.contenders.B.pnlPct, portfolioUsd: match.contenders.B.portfolioUsd },
        },
        outcome: oc,
      });
    }
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

  getMatchMemory(matchId: string, query?: MemoryQuery): MemoryPage {
    if (!this.zeroGMemory) {
      return { events: [], nextCursor: null, source: "memory" };
    }
    return this.zeroGMemory.getMatchMemoryPage(matchId, query);
  }

  getAgentMemory(agentId: string, query?: MemoryQuery): MemoryPage {
    if (!this.zeroGMemory) {
      return { events: [], nextCursor: null, source: "memory" };
    }
    return this.zeroGMemory.getAgentMemoryPage(agentId, query);
  }

  async getMatchMemoryFromZg(matchId: string): Promise<{ raw: string | null; configured: boolean }> {
    if (!this.zeroGMemory) {
      return { raw: null, configured: false };
    }
    const configured = this.zeroGMemory.isEnabled();
    if (!configured) {
      return { raw: null, configured: false };
    }
    const { raw } = await this.zeroGMemory.fetchMatchSnapshotFromZg(matchId);
    return { raw, configured: true };
  }

  onWsConnect(matchId: string, send: (payload: unknown) => void): () => void {
    const match = this.getMatch(matchId);
    if (match) {
      send({ event: "snapshot", match_id: matchId, timestamp: new Date().toISOString(), payload: match });
    }
    return this.store.subscribe(matchId, send);
  }

  onGlobalWsConnect(send: (payload: unknown) => void): () => void {
    const running = this.store.listMatches({ status: "running" });
    for (const match of running) {
      send({ event: "snapshot", match_id: match.id, timestamp: new Date().toISOString(), payload: match });
    }
    return this.store.subscribeGlobal(send);
  }

  private startLoop(matchId: string): void {
    const match = this.store.getMatch(matchId);
    if (!match || match.status !== "running") return;
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
      const oc = computeMatchOutcome(match);
      this.zeroGMemory?.recordMatchCompleted({
        matchId,
        tokenPair: match.tokenPair,
        startingCapitalUsd: match.startingCapitalUsd,
        contenders: {
          A: { agentId: pair.a.agentId, name: pair.a.name, pnlPct: match.contenders.A.pnlPct, portfolioUsd: match.contenders.A.portfolioUsd, trades: match.contenders.A.trades },
          B: { agentId: pair.b.agentId, name: pair.b.name, pnlPct: match.contenders.B.pnlPct, portfolioUsd: match.contenders.B.portfolioUsd, trades: match.contenders.B.trades },
        },
        outcome: oc,
      });
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
    const maxTradeUsd = clampMaxTradeUsd(contender.startingCapitalUsd, {
      maxTradeUsdAbsolute: this.config.trading.maxTradeUsdAbsolute,
    });
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
      minTradeUsd: this.config.trading.minTradeUsd,
      maxTradeUsd,
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
    this.zeroGMemory?.recordDecision({
      matchId,
      agentId: contender.agentId,
      contenderName: contender.name,
      tickNumber,
      decision,
    });
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

    const [base, quote] = match.tokenPair.split("/");
    const baseToken = base ?? "WETH";
    const quoteToken = quote ?? "USDC";
    const maxTradeUsd = clampMaxTradeUsd(contender.startingCapitalUsd, {
      maxTradeUsdAbsolute: this.config.trading.maxTradeUsdAbsolute,
    });

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

  private async resolveSwapMetadata(raw: UniswapQuoteResponse): Promise<{
    executionMode: NonNullable<TradeEvent["executionMode"]>;
    mockSwapBuild?: TradeEvent["mockSwapBuild"];
    unsignedSwap?: TradeEvent["unsignedSwap"];
    swapRequestId?: string;
    swapError?: string;
  }> {
    if (this.config.uniswap.swapMode === "mock") {
      return {
        executionMode: "uniswap_quote_mock",
        mockSwapBuild: this.uniswap.buildMockSwapBuild(raw),
      };
    }
    try {
      let signature: string | undefined;
      if (this.permit2Signer && raw.permitData) {
        signature = await this.permit2Signer.signPermitData(raw.permitData);
      }
      const built = await this.uniswap.createProtocolSwap(raw, signature ? { signature } : undefined);
      return {
        executionMode: "uniswap_live_swap",
        swapRequestId: built.requestId,
        unsignedSwap: {
          ...built.swap,
          gasFee: built.gasFee,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Uniswap] POST /swap failed:", err);
      return {
        executionMode: "uniswap_live_swap",
        swapError: msg,
        mockSwapBuild: this.uniswap.buildMockSwapBuild(raw),
      };
    }
  }

  /**
   * Real `/quote` route sizes + `/check_approval`; `POST /swap` when `UNISWAP_SWAP_MODE=live`.
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
    const minTradeUsd = this.config.trading.minTradeUsd;
    try {
      if (signal.action === "buy") {
        let amountUsd = Math.min(signal.amount, contender.usdcBalance, maxTradeUsd);
        if (amountUsd < minTradeUsd) return true;

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

        const swapMeta = await this.resolveSwapMetadata(q.raw);
        const gasUsd = gasUsdFromQuoteResponse(q.raw) ?? Number((Math.random() * 1.5 + 0.8).toFixed(2));

        const debitQuote = fromBaseUnits(q.amountIn, quoteDecimals);
        const creditBase = fromBaseUnits(q.amountOut, tokenDecimals(baseToken));

        contender.usdcBalance -= debitQuote;
        contender.ethBalance += creditBase;
        contender.tradeCount += 1;
        state.trades += 1;

        const trade: TradeEvent = {
          tradeRecordId: randomUUID(),
          event: "trade_executed",
          contender: contender.name,
          txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
          sold: { token: quoteToken, amount: Number(debitQuote.toFixed(quoteDecimals <= 9 ? 6 : 8)) },
          bought: { token: baseToken, amount: Number(creditBase.toFixed(tokenDecimals(baseToken) <= 9 ? 6 : 8)) },
          gasUsd,
          timestamp: new Date().toISOString(),
          executionMode: swapMeta.executionMode,
          quoteRouting: q.routing,
          mockSwapBuild: swapMeta.mockSwapBuild,
          unsignedSwap: swapMeta.unsignedSwap,
          swapRequestId: swapMeta.swapRequestId,
          swapError: swapMeta.swapError,
          approvalRequestId,
        };

        this.store.addTrade(matchId, trade);
        this.publishEnvelope(matchId, "trade_executed", trade);
        this.zeroGMemory?.recordTrade({
          matchId,
          agentId: contender.agentId,
          contenderName: contender.name,
          trade,
        });
        this.enqueueKeeperHubSubmission(matchId, trade);
        return true;
      }

      if (signal.action === "sell") {
        let amountBase = Math.min(signal.amount, contender.ethBalance);
        if (amountBase < minTradeUsd / currentPrice) return true;

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

        const swapMeta = await this.resolveSwapMetadata(q.raw);
        const gasUsd = gasUsdFromQuoteResponse(q.raw) ?? Number((Math.random() * 1.5 + 0.8).toFixed(2));

        const soldBase = fromBaseUnits(q.amountIn, baseDecimals);
        const boughtQuote = fromBaseUnits(q.amountOut, tokenDecimals(quoteToken));

        contender.ethBalance -= soldBase;
        contender.usdcBalance += boughtQuote;
        contender.tradeCount += 1;
        state.trades += 1;

        const trade: TradeEvent = {
          tradeRecordId: randomUUID(),
          event: "trade_executed",
          contender: contender.name,
          txHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`,
          sold: { token: baseToken, amount: Number(soldBase.toFixed(tokenDecimals(baseToken) <= 9 ? 6 : 8)) },
          bought: { token: quoteToken, amount: Number(boughtQuote.toFixed(6)) },
          gasUsd,
          timestamp: new Date().toISOString(),
          executionMode: swapMeta.executionMode,
          quoteRouting: q.routing,
          mockSwapBuild: swapMeta.mockSwapBuild,
          unsignedSwap: swapMeta.unsignedSwap,
          swapRequestId: swapMeta.swapRequestId,
          swapError: swapMeta.swapError,
          approvalRequestId,
        };

        this.store.addTrade(matchId, trade);
        this.publishEnvelope(matchId, "trade_executed", trade);
        this.zeroGMemory?.recordTrade({
          matchId,
          agentId: contender.agentId,
          contenderName: contender.name,
          trade,
        });
        this.enqueueKeeperHubSubmission(matchId, trade);
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
    const minTradeUsd = this.config.trading.minTradeUsd;
    if (signal.action === "buy") {
      let amountUsd = Math.min(signal.amount, contender.usdcBalance, maxTradeUsd);
      if (amountUsd < minTradeUsd) return;

      const ethBought = amountUsd / currentPrice;
      contender.usdcBalance -= amountUsd;
      contender.ethBalance += ethBought;
      contender.tradeCount += 1;
      state.trades += 1;

      const trade: TradeEvent = {
        tradeRecordId: randomUUID(),
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
      this.zeroGMemory?.recordTrade({
        matchId,
        agentId: contender.agentId,
        contenderName: contender.name,
        trade,
      });
    }

    if (signal.action === "sell") {
      let amountEth = Math.min(signal.amount, contender.ethBalance);
      if (amountEth < minTradeUsd / currentPrice) return;

      const amountUsd = amountEth * currentPrice;
      if (amountUsd > maxTradeUsd) {
        amountEth = maxTradeUsd / currentPrice;
      }

      contender.ethBalance -= amountEth;
      contender.usdcBalance += amountEth * currentPrice;
      contender.tradeCount += 1;
      state.trades += 1;

      const trade: TradeEvent = {
        tradeRecordId: randomUUID(),
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
      this.zeroGMemory?.recordTrade({
        matchId,
        agentId: contender.agentId,
        contenderName: contender.name,
        trade,
      });
    }
  }

  private recalcPortfolios(match: MatchState, pair: { a: ContenderRuntime; b: ContenderRuntime }): void {
    const price = match.ethPrice;
    match.contenders.A.portfolioUsd = Number((pair.a.usdcBalance + pair.a.ethBalance * price).toFixed(2));
    match.contenders.B.portfolioUsd = Number((pair.b.usdcBalance + pair.b.ethBalance * price).toFixed(2));
    match.contenders.A.pnlPct = pnlPctFromPortfolio(match.contenders.A.portfolioUsd, match.contenders.A.startingCapitalUsd);
    match.contenders.B.pnlPct = pnlPctFromPortfolio(match.contenders.B.portfolioUsd, match.contenders.B.startingCapitalUsd);
  }

  private async fetchPrice(fallbackPrice: number, tokenPair: string): Promise<number> {
    try {
      const [base, quote] = tokenPair.split("/");
      const result = await this.uniswap.getPrice(quote ?? "USDC", base ?? "WETH");
      if (result.price > 0 && Number.isFinite(result.price)) {
        return Number(result.price.toFixed(2));
      }
    } catch (err) {
      console.error("[UniswapClient] price fetch failed, reusing previous price:", err);
    }

    return fallbackPrice;
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
    const { resultA, resultB } = computeMatchOutcome(match);
    const pnlA = match.contenders.A.pnlPct;
    const pnlB = match.contenders.B.pnlPct;

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

  private enqueueKeeperHubSubmission(matchId: string, trade: TradeEvent): void {
    if (!this.keeperHub || !this.keeperHubPoller) return;
    if (this.config.uniswap.swapMode !== "live") return;
    const recordId = trade.tradeRecordId;
    if (!recordId) return;
    if (!trade.unsignedSwap || trade.swapError) return;

    void this.processKeeperHubSubmission(matchId, recordId, trade);
  }

  private async processKeeperHubSubmission(
    matchId: string,
    tradeRecordId: string,
    trade: TradeEvent,
  ): Promise<void> {
    const kh = this.keeperHub;
    const poller = this.keeperHubPoller;
    if (!kh || !poller) return;

    const submission = await kh.submitUnsignedSwap(trade.unsignedSwap!, this.config.uniswap.chainId);

    if (!submission.ok) {
      this.store.updateTradeExecution(matchId, tradeRecordId, {
        lastExecutionError: submission.error,
        keeperhubRetryCount: submission.httpRetries,
      });
      this.publishUpdatedTrade(matchId, tradeRecordId);
      return;
    }

    const raw = submission.result.raw;
    let execReceipt: Record<string, unknown> | undefined;
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      execReceipt =
        "data" in o && o.data !== undefined && typeof o.data === "object" && o.data !== null
          ? (o.data as Record<string, unknown>)
          : { ...o };
    }

    this.store.updateTradeExecution(matchId, tradeRecordId, {
      keeperhubSubmissionId: submission.result.executionId,
      keeperhubStatus: normalizeKeeperHubStatus(submission.result.status),
      keeperhubRetryCount: submission.httpRetries,
      executionReceipt: execReceipt ?? { raw },
    });

    poller.register(matchId, tradeRecordId, submission.result.executionId);
    this.publishUpdatedTrade(matchId, tradeRecordId);
  }

  private publishUpdatedTrade(matchId: string, tradeRecordId: string): void {
    const trades = this.store.getTrades(matchId);
    const t = trades.find((x) => x.tradeRecordId === tradeRecordId);
    if (t) {
      this.publishEnvelope(matchId, "trade_executed", t);
    }
  }

  private publishEnvelope(matchId: string, eventType: WsEnvelope["event"], payload: unknown): void {
    const envelope: WsEnvelope = { event: eventType, match_id: matchId, timestamp: new Date().toISOString(), payload };
    this.store.publish(matchId, envelope);
    this.store.publishGlobal(envelope);
  }
}
