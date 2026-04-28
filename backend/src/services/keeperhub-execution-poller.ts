import type { KeeperHubClient } from "../integrations/keeperhub.js";
import type { AppConfig } from "../config.js";
import type { Store } from "../store/store.js";
import type { TradeEvent, WsEnvelope } from "../types.js";

type Pending = {
  matchId: string;
  tradeRecordId: string;
  /** Successful status polls while execution is still non-terminal */
  pollCount: number;
  /** Consecutive failed HTTP/status reads */
  errorStreak: number;
};

/**
 * Polls KeeperHub for non-terminal executions registered via {@link register}.
 * Started explicitly by the app (`start()`) so smoke tests don't spin timers.
 */
export class KeeperHubExecutionPoller {
  private readonly pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: Store,
    private readonly client: KeeperHubClient,
    private readonly cfg: AppConfig["keeperhub"],
  ) {}

  private publishTradeEnvelope(matchId: string, tradeRecordId: string): void {
    const trades = this.store.getTrades(matchId);
    const t = trades.find((x) => x.tradeRecordId === tradeRecordId);
    if (!t) return;
    const envelope: WsEnvelope = {
      event: "trade_executed",
      match_id: matchId,
      timestamp: new Date().toISOString(),
      payload: t,
    };
    this.store.publish(matchId, envelope);
  }

  start(): void {
    if (this.timer) return;
    const interval = Math.max(1000, this.cfg.pollIntervalMs);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  register(matchId: string, tradeRecordId: string, executionId: string): void {
    this.pending.set(executionId, { matchId, tradeRecordId, pollCount: 0, errorStreak: 0 });
    void this.pollOne(executionId);
  }

  private async tick(): Promise<void> {
    const ids = [...this.pending.keys()];
    await Promise.all(ids.map((id) => this.pollOne(id)));
  }

  private async pollOne(executionId: string): Promise<void> {
    const ctx = this.pending.get(executionId);
    if (!ctx) return;

    const res = await this.client.getExecutionStatus(executionId);
    if (!res.ok) {
      ctx.errorStreak += 1;
      const patch: Partial<TradeEvent> = {
        lastExecutionError: res.error,
        keeperhubRetryCount: res.httpRetries,
      };
      this.store.updateTradeExecution(ctx.matchId, ctx.tradeRecordId, patch);
      this.publishTradeEnvelope(ctx.matchId, ctx.tradeRecordId);
      if (ctx.errorStreak >= 12) {
        this.pending.delete(executionId);
        this.store.updateTradeExecution(ctx.matchId, ctx.tradeRecordId, {
          lastExecutionError: `KeeperHub status polling failed repeatedly: ${res.error}`,
          keeperhubStatus: "failed",
        });
        this.publishTradeEnvelope(ctx.matchId, ctx.tradeRecordId);
      }
      return;
    }

    ctx.errorStreak = 0;

    const st = res.status;
    const normalizedStatus = (st.status ?? "").toLowerCase();
    const isTerminal = normalizedStatus === "completed" || normalizedStatus === "failed";

    if (!isTerminal) {
      ctx.pollCount += 1;
      if (ctx.pollCount > this.cfg.maxPollAttempts) {
        this.pending.delete(executionId);
        const patch: Partial<TradeEvent> = {
          lastExecutionError: `KeeperHub poll exceeded max attempts (${this.cfg.maxPollAttempts})`,
          keeperhubStatus: "failed",
        };
        this.store.updateTradeExecution(ctx.matchId, ctx.tradeRecordId, patch);
        this.publishTradeEnvelope(ctx.matchId, ctx.tradeRecordId);
        return;
      }
    }

    const receipt: Record<string, unknown> = {
      ...(typeof st.result === "object" && st.result !== null ? (st.result as Record<string, unknown>) : {}),
      executionId: st.executionId,
      type: st.type,
      gasUsedWei: st.gasUsedWei,
      createdAt: st.createdAt,
      completedAt: st.completedAt,
      rawStatus: st.raw,
    };

    const patch: Partial<TradeEvent> = {
      keeperhubStatus: normalizedStatus,
      keeperhubRetryCount: res.httpRetries,
      executionReceipt: receipt,
      keeperhubTransactionLink: st.transactionLink ?? undefined,
      lastExecutionError: st.error ?? undefined,
    };

    const txHash = st.transactionHash ?? undefined;
    if (txHash) {
      patch.onChainTxHash = txHash;
      patch.txHash = txHash;
    }

    this.store.updateTradeExecution(ctx.matchId, ctx.tradeRecordId, patch);
    this.publishTradeEnvelope(ctx.matchId, ctx.tradeRecordId);

    if (normalizedStatus === "completed" || normalizedStatus === "failed") {
      this.pending.delete(executionId);
    }
  }
}
