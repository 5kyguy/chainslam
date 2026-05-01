import { Clock3, PauseCircle, RefreshCw, Radio, Zap } from "lucide-react";
import type { MatchState, WsStatus } from "../types";
import { cn, formatDuration, formatUsd, shortId, winnerSide } from "../utils";
import { StatusPill } from "./StatusPill";

interface MatchHeaderProps {
  match: MatchState | null;
  wsStatus: WsStatus;
  refreshing: boolean;
  onRefresh: () => void;
  onStop: () => void;
}

export function MatchHeader({ match, wsStatus, refreshing, onRefresh, onStop }: MatchHeaderProps) {
  const winner = winnerSide(match);
  const statusVariant = match?.status === "running" ? "live" : match?.status === "completed" ? "good" : match?.status === "stopped" ? "warn" : "neutral";
  const wsVariant = wsStatus === "connected" ? "live" : wsStatus === "error" ? "bad" : wsStatus === "reconnecting" ? "warn" : "neutral";

  return (
    <section className="panel grid w-full min-w-0 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
      <div className="min-w-0">
        <p className="label">Arena Cockpit</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-zinc-50 sm:text-2xl">
            {match ? `${match.tokenPair} Battle` : "Ready For Match"}
          </h1>
          {match ? <StatusPill label={match.status} variant={statusVariant} /> : <StatusPill label="standby" variant="idle" />}
        </div>
        <p className="mt-2 truncate font-mono text-xs text-zinc-500">{match ? shortId(match.id, 12, 4) : "Create two agents and start a live backend match."}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
        <Metric icon={Clock3} label="Timer" value={match ? formatDuration(match.timeRemainingSeconds) : "--:--"} />
        <Metric icon={Zap} label="ETH" value={match ? formatUsd(match.ethPrice, 2) : "-"} />
        <Metric icon={Radio} label="Socket" value={wsStatus} tone={wsVariant === "live" ? "text-teal-200" : "text-zinc-200"} />
      </div>

      <div className="flex min-w-0 flex-wrap justify-start gap-2 lg:justify-end">
        {winner ? (
          <div className="mr-auto min-w-0 border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 lg:mr-0">
            Winner: {winner === "draw" ? "Draw" : `Agent ${winner}`}
          </div>
        ) : null}
        <button type="button" className="icon-button" onClick={onRefresh} disabled={refreshing} title="Refresh match data">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
        <StatusPill label={`ws ${wsStatus}`} variant={wsVariant} />
        <button type="button" className="danger-button" onClick={onStop} disabled={match?.status !== "running"} title="Stop running match">
          <PauseCircle className="h-4 w-4" />
          Stop
        </button>
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "text-zinc-100",
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="panel-inset min-w-0 px-3 py-2">
      <div className="mx-auto mb-1 flex items-center justify-center gap-1 text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="label">{label}</span>
      </div>
      <div className={cn("truncate font-mono text-sm font-semibold", tone)}>{value}</div>
    </div>
  );
}
