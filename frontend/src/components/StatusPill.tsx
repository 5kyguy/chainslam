import { AlertTriangle, CheckCircle2, Circle, Clock3, Radio, XCircle } from "lucide-react";
import { cn } from "../utils";

type Variant = "idle" | "live" | "good" | "warn" | "bad" | "neutral";

const variantClass: Record<Variant, string> = {
  idle: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300",
  live: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  bad: "border-red-400/30 bg-red-400/10 text-red-200",
  neutral: "border-white/10 bg-white/[0.04] text-zinc-300",
};

const iconMap: Record<Variant, typeof Circle> = {
  idle: Circle,
  live: Radio,
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  neutral: Clock3,
};

export function StatusPill({ label, variant = "neutral", className }: { label: string; variant?: Variant; className?: string }) {
  const Icon = iconMap[variant];
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        variantClass[variant],
        className,
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
