import { Activity, BarChart3, Swords, WalletCards } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ContenderState, SeriesPoint, StrategyOption } from "../types";
import { cn, formatPct, formatUsd } from "../utils";

interface AgentPanelProps {
  side: "A" | "B";
  contender?: ContenderState;
  strategy?: StrategyOption;
  status: string;
  series: SeriesPoint[];
  isWinner: boolean;
}

export function AgentPanel({ side, contender, strategy, status, series, isWinner }: AgentPanelProps) {
  const pnl = contender?.pnlPct ?? 0;
  const positive = pnl >= 0;
  const barWidth = Math.min(100, Math.max(4, Math.abs(pnl) * 10));
  const stroke = side === "A" ? "#2dd4bf" : "#f59e0b";

  return (
    <section className={cn("panel min-w-0 overflow-hidden", isWinner && "border-emerald-300/50")}>
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <p className="label">Agent {side}</p>
          <h3 className="truncate text-lg font-semibold text-zinc-50">{contender?.name ?? "No contender"}</h3>
          <p className="mt-1 truncate text-sm text-zinc-400">{strategy ? `${strategy.name} - ${strategy.riskProfile}` : status}</p>
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center border font-mono font-bold", side === "A" ? "border-teal-300/40 bg-teal-400/10 text-teal-200" : "border-amber-300/40 bg-amber-400/10 text-amber-200")}>
          {side}
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={WalletCards} label="Portfolio" value={formatUsd(contender?.portfolioUsd)} />
          <Stat icon={BarChart3} label="PnL" value={formatPct(contender?.pnlPct)} tone={positive ? "text-emerald-200" : "text-red-200"} />
          <Stat icon={Swords} label="Trades" value={String(contender?.trades ?? 0)} />
        </div>

        <div className="panel-inset p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="label">Performance</span>
            <span className={positive ? "text-emerald-200" : "text-red-200"}>{formatPct(pnl)}</span>
          </div>
          <div className="relative h-3 overflow-hidden bg-black/40">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
            <div
              className={cn("absolute top-0 h-full", positive ? "left-1/2 bg-emerald-400" : "right-1/2 bg-red-400")}
              style={{ width: `${barWidth / 2}%` }}
            />
          </div>
        </div>

        <div className="panel-inset h-32 min-w-0 p-2">
          {series.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id={`agent-${side}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#0d1015", border: "1px solid rgba(255,255,255,0.12)", color: "#f4f4f5" }}
                  labelStyle={{ color: "#a1a1aa" }}
                  formatter={(value) => [`${Number(value).toFixed(2)}%`, `Agent ${side}`]}
                />
                <Area type="monotone" dataKey={side} stroke={stroke} strokeWidth={2} fill={`url(#agent-${side})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
              <Activity className="h-4 w-4" />
              Awaiting snapshots
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "text-zinc-100",
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="panel-inset min-w-0 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="label">{label}</span>
      </div>
      <div className={cn("truncate font-mono text-sm font-semibold", tone)}>{value}</div>
    </div>
  );
}
