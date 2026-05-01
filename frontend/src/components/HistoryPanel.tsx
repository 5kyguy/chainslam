import { History, Play, RefreshCw } from "lucide-react";
import type { MatchState, MatchStatus } from "../types";
import { cn, formatDuration, formatPct, formatUsd, relativeTime, shortId } from "../utils";
import { StatusPill } from "./StatusPill";

interface HistoryPanelProps {
  matches: MatchState[];
  filter?: MatchStatus;
  loading: boolean;
  onFilterChange: (status?: MatchStatus) => void;
  onSelect: (match: MatchState) => void;
  onRefresh: () => void;
}

const filters: Array<{ label: string; value?: MatchStatus }> = [
  { label: "All" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
];

export function HistoryPanel({ matches, filter, loading, onFilterChange, onSelect, onRefresh }: HistoryPanelProps) {
  return (
    <section className="panel min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <History className="h-5 w-5 text-teal-300" />
          <div className="min-w-0">
            <p className="label">History</p>
            <h2 className="truncate text-lg font-semibold text-zinc-50">Recent Matches</h2>
          </div>
        </div>
        <button type="button" className="icon-button shrink-0" onClick={onRefresh} disabled={loading} title="Refresh history">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="border-b border-white/10 p-3">
        <div className="grid grid-cols-4 gap-1 border border-white/10 bg-black/20 p-1">
          {filters.map((item) => (
            <button
              key={item.label}
              type="button"
              className={cn(
                "h-8 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400 transition hover:text-zinc-100",
                filter === item.value && "bg-white/10 text-zinc-100",
              )}
              onClick={() => onFilterChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[360px] overflow-y-auto p-3">
        {matches.length === 0 ? (
          <div className="border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">No matches for this filter.</div>
        ) : (
          <div className="grid gap-2">
            {matches.map((match) => (
              <button key={match.id} type="button" className="panel-inset min-w-0 p-3 text-left transition hover:border-white/20 hover:bg-terminal-800" onClick={() => onSelect(match)}>
                <div className="flex items-center gap-2">
                  <Play className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="min-w-0 truncate font-mono text-xs text-zinc-400">{shortId(match.id, 10, 4)}</span>
                  <StatusPill label={match.status} variant={match.status === "running" ? "live" : match.status === "completed" ? "good" : "warn"} />
                  <span className="ml-auto font-mono text-xs text-zinc-500">{relativeTime(match.createdAt)}</span>
                </div>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <span className="truncate text-zinc-100">{match.tokenPair}</span>
                  <span className="font-mono text-zinc-400">{formatDuration(match.timeRemainingSeconds)}</span>
                  <span className="font-mono text-zinc-400">{formatUsd(match.startingCapitalUsd, 0)}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                  <span className="truncate">A {formatPct(match.contenders.A.pnlPct)}</span>
                  <span className="truncate">B {formatPct(match.contenders.B.pnlPct)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
