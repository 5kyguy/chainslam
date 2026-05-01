import { ArrowDownUp, BrainCircuit, CheckCircle2, ExternalLink, Radio } from "lucide-react";
import type { DecisionEvent, FeedEvent, TradeEvent, WsStatus } from "../types";
import { cn, formatNumber, formatUsd, isTradeEvent, relativeTime, shortId, txHref } from "../utils";
import { StatusPill } from "./StatusPill";

export function EventFeed({ events, wsStatus }: { events: FeedEvent[]; wsStatus: WsStatus }) {
  return (
    <section className="panel flex min-h-[420px] min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <p className="label">Live Feed</p>
          <h2 className="truncate text-lg font-semibold text-zinc-50">Decisions And Trades</h2>
        </div>
        <StatusPill label={wsStatus} variant={wsStatus === "connected" ? "live" : wsStatus === "error" ? "bad" : "neutral"} />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {events.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center border border-dashed border-white/10 bg-black/20 p-6 text-center text-sm text-zinc-500">
            WebSocket events and persisted feed rows will appear here after the first tick.
          </div>
        ) : (
          <div className="grid gap-2">
            {events.map((event) => (isTradeEvent(event) ? <TradeRow key={event.tradeRecordId ?? `${event.txHash}-${event.timestamp}`} event={event} /> : <DecisionRow key={`${event.contender}-${event.action}-${event.timestamp}`} event={event} />))}
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionRow({ event }: { event: DecisionEvent }) {
  const actionClass =
    event.action === "buy"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : event.action === "sell"
        ? "border-red-400/30 bg-red-400/10 text-red-200"
        : "border-zinc-500/25 bg-zinc-500/10 text-zinc-300";

  return (
    <article className="panel-inset min-w-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-teal-300" />
        <span className="truncate text-sm font-semibold text-zinc-100">{event.contender}</span>
        <span className={cn("border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]", actionClass)}>{event.action}</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">{relativeTime(event.timestamp)}</span>
      </div>
      <div className="mt-2 grid gap-2 text-sm text-zinc-300 sm:grid-cols-[auto_auto_1fr]">
        <span className="font-mono">{formatUsd(event.amount, 4)}</span>
        <span className="font-mono text-zinc-500">confidence {Math.round(event.confidence * 100)}%</span>
        <span className="min-w-0 text-zinc-400">{event.reasoning}</span>
      </div>
    </article>
  );
}

function TradeRow({ event }: { event: TradeEvent }) {
  const href = txHref(event);
  return (
    <article className="panel-inset min-w-0 border-teal-300/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ArrowDownUp className="h-4 w-4 text-amber-300" />
        <span className="truncate text-sm font-semibold text-zinc-100">{event.contender}</span>
        <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-100">
          trade
        </span>
        {event.keeperhubStatus ? (
          <span className="border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-100">
            KeeperHub {event.keeperhubStatus}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-zinc-500">{relativeTime(event.timestamp)}</span>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
        <TradeAmount label="Sold" token={event.sold.token} amount={event.sold.amount} />
        <TradeAmount label="Bought" token={event.bought.token} amount={event.bought.amount} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-mono">gas {formatUsd(event.gasUsd, 4)}</span>
        <span className="font-mono">{event.executionMode ?? "unknown"}</span>
        {event.quoteRouting ? <span className="font-mono">route {event.quoteRouting}</span> : null}
        <span className="font-mono">tx {shortId(event.onChainTxHash ?? event.txHash)}</span>
        {href ? (
          <a className="inline-flex items-center gap-1 text-teal-200 hover:text-teal-100" href={href} target="_blank" rel="noreferrer">
            Etherscan <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {event.swapError || event.lastExecutionError ? (
          <span className="inline-flex items-center gap-1 text-red-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {event.swapError ?? event.lastExecutionError}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function TradeAmount({ label, token, amount }: { label: string; token: string; amount: number }) {
  return (
    <div className="border border-white/10 bg-black/20 px-3 py-2">
      <div className="label">{label}</div>
      <div className="mt-1 truncate font-mono text-zinc-100">
        {formatNumber(amount, 8)} {token}
      </div>
    </div>
  );
}
