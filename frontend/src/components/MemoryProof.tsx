import { DatabaseZap, ExternalLink, RefreshCw } from "lucide-react";
import type { MemoryEvent, MemoryPage, ZeroGSnapshot } from "../types";
import { cn, relativeTime, shortId } from "../utils";
import { StatusPill } from "./StatusPill";

interface MemoryProofProps {
  memory: MemoryPage | null;
  zeroG: ZeroGSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}

export function MemoryProof({ memory, zeroG, loading, onRefresh }: MemoryProofProps) {
  return (
    <section className="panel min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <DatabaseZap className="h-5 w-5 text-teal-300" />
          <div className="min-w-0">
            <p className="label">Memory Proof</p>
            <h2 className="truncate text-lg font-semibold text-zinc-50">0G Timeline</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill label={zeroG?.configured ? "0G configured" : "memory"} variant={zeroG?.configured ? "live" : "neutral"} />
          <button type="button" className="icon-button" onClick={onRefresh} disabled={loading} title="Refresh memory">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <ProofMetric label="Source" value={memory?.source ?? "-"} />
          <ProofMetric label="Events" value={String(memory?.events.length ?? 0)} />
          <ProofMetric label="Last Tx" value={shortId(memory?.lastTxHash)} />
        </div>

        {memory?.events.length ? (
          <div className="grid max-h-[260px] gap-2 overflow-y-auto">
            {memory.events.map((event, index) => (
              <MemoryRow key={`${event.kind}-${event.ts}-${index}`} event={event} />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-500">
            Memory events appear when the backend 0G memory service is enabled. The panel stays available for demos even when remote KV reads are missing.
          </div>
        )}

        {zeroG?.raw ? (
          <details className="border border-teal-400/20 bg-teal-400/10 p-3 text-xs text-zinc-300">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold text-teal-100">
              Raw 0G snapshot <ExternalLink className="h-3.5 w-3.5" />
            </summary>
            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono">{zeroG.raw}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ProofMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-black/20 px-3 py-2">
      <div className="label">{label}</div>
      <div className="mt-1 truncate font-mono text-zinc-200">{value}</div>
    </div>
  );
}

function MemoryRow({ event }: { event: MemoryEvent }) {
  return (
    <article className="panel-inset min-w-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-100">
          {event.kind.replace("_", " ")}
        </span>
        {event.contenderName ? <span className="truncate text-sm font-semibold text-zinc-100">{event.contenderName}</span> : null}
        <span className="ml-auto font-mono text-xs text-zinc-500">{relativeTime(event.ts)}</span>
      </div>
      <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-500">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </article>
  );
}
