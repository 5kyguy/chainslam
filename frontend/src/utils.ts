import type { FeedEvent, KeeperHubExecutionAudit, MatchState, TradeEvent } from "./types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatUsd(value: number | undefined, maximumFractionDigits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

export function formatNumber(value: number | undefined, maximumFractionDigits = 4): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDuration(totalSeconds: number | undefined): string {
  const safe = Math.max(0, Math.floor(totalSeconds ?? 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function shortId(value: string | undefined, left = 8, right = 4): string {
  if (!value) return "-";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "-";
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function eventKey(event: FeedEvent): string {
  if (event.event === "trade_executed") {
    return event.tradeRecordId ?? `${event.event}:${event.contender}:${event.txHash}:${event.timestamp}`;
  }
  return `${event.event}:${event.contender}:${event.action}:${event.timestamp}`;
}

export function mergeFeed(existing: FeedEvent[], incoming: FeedEvent[]): FeedEvent[] {
  const byKey = new Map(existing.map((event) => [eventKey(event), event]));
  for (const event of incoming) {
    byKey.set(eventKey(event), event);
  }
  return Array.from(byKey.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function isTradeEvent(event: FeedEvent): event is TradeEvent {
  return event.event === "trade_executed";
}

export function txHref(execution: KeeperHubExecutionAudit | TradeEvent): string | undefined {
  if (execution.keeperhubTransactionLink) return execution.keeperhubTransactionLink;
  if (execution.onChainTxHash) return `https://sepolia.etherscan.io/tx/${execution.onChainTxHash}`;
  return undefined;
}

export function winnerSide(match: MatchState | null): "A" | "B" | "draw" | null {
  if (!match || match.status !== "completed") return null;
  const a = match.contenders.A.pnlPct;
  const b = match.contenders.B.pnlPct;
  if (Math.abs(a - b) < 0.000001) return "draw";
  return a > b ? "A" : "B";
}
