import type { AppConfig } from "../config.js";
import type { DecisionEvent, TradeEvent } from "../types.js";
import type { MatchOutcome } from "./match-outcome.js";
import { ZeroGKvClient } from "../integrations/zerog.js";

const SCHEMA_VERSION = 1 as const;

export type MemoryEventKind = "match_started" | "decision" | "trade_executed" | "match_completed" | "match_stopped";

export interface MemoryEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: MemoryEventKind;
  ts: string;
  matchId: string;
  /** Set when the row is agent-scoped */
  agentId?: string;
  contenderName?: string;
  payload: Record<string, unknown>;
}

export interface MemoryQuery {
  limit?: number;
  /** Offset into the in-memory event list (newest appends at end) */
  cursor?: number;
}

export interface MemoryPage {
  events: MemoryEvent[];
  nextCursor: number | null;
  source: "memory" | "zerog";
  lastTxHash?: string;
}

export class ZeroGMemoryService {
  private readonly eventsByMatch = new Map<string, MemoryEvent[]>();
  private readonly eventsByAgent = new Map<string, MemoryEvent[]>();
  private lastFlushTxHash: string | undefined;
  private writePausedUntil = 0;
  private lastCooldownLogAt = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly kv?: ZeroGKvClient,
  ) {}

  isEnabled(): boolean {
    return !!this.kv?.isConfigured();
  }

  private matchKey(matchId: string): string {
    return `${this.config.zerog.keyPrefix}/match/${matchId}`;
  }

  private agentKey(agentId: string): string {
    return `${this.config.zerog.keyPrefix}/agent/${agentId}`;
  }

  private pushEvent(ev: MemoryEvent): void {
    const mid = ev.matchId;
    const list = this.eventsByMatch.get(mid) ?? [];
    list.push(ev);
    this.eventsByMatch.set(mid, list);

    if (ev.agentId) {
      const al = this.eventsByAgent.get(ev.agentId) ?? [];
      al.push(ev);
      this.eventsByAgent.set(ev.agentId, al);
    }

    if (this.shouldFlushOnEvent(ev)) {
      void this.flushMatchNow(mid);
    }
  }

  private shouldFlushOnEvent(ev: MemoryEvent): boolean {
    if (ev.kind === "match_started" || ev.kind === "match_completed" || ev.kind === "match_stopped") {
      return true;
    }
    if (ev.kind === "trade_executed") {
      return true;
    }
    if (ev.kind === "decision") {
      const action = String((ev.payload as { action?: unknown }).action ?? "").toLowerCase();
      // Hold ticks are high-frequency and do not materially change state.
      return action !== "hold";
    }
    return false;
  }

  private snapshotMatch(matchId: string): { events: MemoryEvent[] } {
    return { events: [...(this.eventsByMatch.get(matchId) ?? [])] };
  }

  private async flushMatchNow(matchId: string): Promise<void> {
    if (!this.kv?.isConfigured()) return;
    const now = Date.now();
    if (now < this.writePausedUntil) {
      // Keep logs useful without spamming each debounce tick while remote KV/indexer is behind.
      if (now - this.lastCooldownLogAt > 30_000) {
        this.lastCooldownLogAt = now;
        console.warn("[ZeroGMemory] write paused during cooldown", {
          matchId,
          resumeAt: new Date(this.writePausedUntil).toISOString(),
        });
      }
      return;
    }
    const snap = this.snapshotMatch(matchId);
    const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...snap });
    const key = this.matchKey(matchId);
    const res = await this.kv.putText(key, json);
    if (!res) {
      this.writePausedUntil = Date.now() + Math.max(0, this.config.zerog.writeCooldownMs);
      this.lastCooldownLogAt = Date.now();
      console.warn("[ZeroGMemory] write failed; entering cooldown", {
        matchId,
        cooldownMs: this.config.zerog.writeCooldownMs,
        resumeAt: new Date(this.writePausedUntil).toISOString(),
      });
      return;
    }
    this.lastFlushTxHash = res.txHash;
    console.log("[ZeroGMemory] flushed match snapshot", { matchId, txHash: res.txHash });

    const agentIds = new Set<string>();
    for (const ev of snap.events) {
      if (ev.agentId) agentIds.add(ev.agentId);
    }
    for (const aid of agentIds) {
      const agentSnap = { schemaVersion: SCHEMA_VERSION, events: [...(this.eventsByAgent.get(aid) ?? [])] };
      await this.kv.putText(this.agentKey(aid), JSON.stringify(agentSnap));
    }
  }

  recordMatchStarted(meta: {
    matchId: string;
    tokenPair: string;
    startingCapitalUsd: number;
    startingCapitalUsdA?: number;
    startingCapitalUsdB?: number;
    durationSeconds: number;
    contenderA: { agentId: string; name: string; strategy: string };
    contenderB: { agentId: string; name: string; strategy: string };
  }): void {
    const ev: MemoryEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: "match_started",
      ts: new Date().toISOString(),
      matchId: meta.matchId,
      payload: meta as unknown as Record<string, unknown>,
    };
    this.pushEvent(ev);
  }

  recordDecision(params: {
    matchId: string;
    agentId: string;
    contenderName: string;
    tickNumber: number;
    decision: DecisionEvent;
  }): void {
    const ev: MemoryEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: "decision",
      ts: params.decision.timestamp,
      matchId: params.matchId,
      agentId: params.agentId,
      contenderName: params.contenderName,
      payload: {
        tickNumber: params.tickNumber,
        action: params.decision.action,
        amount: params.decision.amount,
        reasoning: params.decision.reasoning,
        confidence: params.decision.confidence,
      },
    };
    this.pushEvent(ev);
  }

  recordTrade(params: { matchId: string; agentId: string; contenderName: string; trade: TradeEvent }): void {
    const { trade } = params;
    const ev: MemoryEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: "trade_executed",
      ts: trade.timestamp,
      matchId: params.matchId,
      agentId: params.agentId,
      contenderName: params.contenderName,
      payload: { trade: { ...trade } },
    };
    this.pushEvent(ev);
  }

  recordMatchCompleted(payload: {
    matchId: string;
    tokenPair: string;
    startingCapitalUsd: number;
    contenders: {
      A: { agentId: string; name: string; pnlPct: number; portfolioUsd: number; trades: number };
      B: { agentId: string; name: string; pnlPct: number; portfolioUsd: number; trades: number };
    };
    outcome: MatchOutcome;
  }): void {
    const ev: MemoryEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: "match_completed",
      ts: new Date().toISOString(),
      matchId: payload.matchId,
      payload: payload as unknown as Record<string, unknown>,
    };
    this.pushEvent(ev);
  }

  recordMatchStopped(payload: {
    matchId: string;
    status: "stopped";
    contenders: {
      A: { agentId: string; name: string; pnlPct: number; portfolioUsd: number };
      B: { agentId: string; name: string; pnlPct: number; portfolioUsd: number };
    };
    outcome: MatchOutcome;
  }): void {
    const ev: MemoryEvent = {
      schemaVersion: SCHEMA_VERSION,
      kind: "match_stopped",
      ts: new Date().toISOString(),
      matchId: payload.matchId,
      payload: payload as unknown as Record<string, unknown>,
    };
    this.pushEvent(ev);
  }

  /** Paginated slice over in-memory timeline (stable ordering). */
  getMatchMemoryPage(matchId: string, query?: MemoryQuery): MemoryPage {
    const all = this.eventsByMatch.get(matchId) ?? [];
    const cursor = Math.max(0, query?.cursor ?? 0);
    const limit = Math.min(500, Math.max(1, query?.limit ?? 100));
    const slice = all.slice(cursor, cursor + limit);
    const next = cursor + slice.length < all.length ? cursor + slice.length : null;
    return {
      events: slice,
      nextCursor: next,
      source: "memory",
      lastTxHash: this.lastFlushTxHash,
    };
  }

  getAgentMemoryPage(agentId: string, query?: MemoryQuery): MemoryPage {
    const all = this.eventsByAgent.get(agentId) ?? [];
    const cursor = Math.max(0, query?.cursor ?? 0);
    const limit = Math.min(500, Math.max(1, query?.limit ?? 100));
    const slice = all.slice(cursor, cursor + limit);
    const next = cursor + slice.length < all.length ? cursor + slice.length : null;
    return {
      events: slice,
      nextCursor: next,
      source: "memory",
      lastTxHash: this.lastFlushTxHash,
    };
  }

  /** Optional read-through from 0G KV (same match aggregate key). */
  async fetchMatchSnapshotFromZg(matchId: string): Promise<{ raw: string | null }> {
    if (!this.kv?.isConfigured()) return { raw: null };
    const raw = await this.kv.getText(this.matchKey(matchId));
    return { raw };
  }
}
