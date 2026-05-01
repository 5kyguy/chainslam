import { ExternalLink, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { KeeperHubExecutionAudit } from "../types";
import { cn, formatNumber, relativeTime, shortId, txHref } from "../utils";
import { StatusPill } from "./StatusPill";

interface ExecutionProofProps {
  executions: KeeperHubExecutionAudit[];
  loading: boolean;
  onRefresh: () => void;
}

export function ExecutionProof({ executions, loading, onRefresh }: ExecutionProofProps) {
  const completed = executions.filter((execution) => execution.keeperhubStatus?.toLowerCase() === "completed").length;

  return (
    <section className="panel min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <p className="label">Execution Proof</p>
          <h2 className="truncate text-lg font-semibold text-zinc-50">KeeperHub Audit</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill label={`${completed}/${executions.length} complete`} variant={completed > 0 ? "good" : "neutral"} />
          <button type="button" className="icon-button" onClick={onRefresh} disabled={loading} title="Refresh executions">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        {executions.length === 0 ? (
          <div className="border border-dashed border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-500">
            No KeeperHub execution rows yet. Paper and quote-only trades still appear in the live feed; live execution proof appears after the backend submits swaps.
          </div>
        ) : (
          executions.map((execution) => <ExecutionCard key={execution.tradeRecordId || `${execution.contender}-${execution.timestamp}`} execution={execution} />)
        )}
      </div>
    </section>
  );
}

function ExecutionCard({ execution }: { execution: KeeperHubExecutionAudit }) {
  const status = execution.keeperhubStatus?.toLowerCase() ?? (execution.lastExecutionError ? "failed" : "pending");
  const completed = status === "completed";
  const failed = status === "failed" || Boolean(execution.lastExecutionError);
  const href = txHref(execution);

  return (
    <article className={cn("panel-inset min-w-0 p-3", completed && "border-emerald-300/50 bg-emerald-400/10", failed && "border-red-300/40 bg-red-400/10")}>
      <div className="flex flex-wrap items-center gap-2">
        {failed ? <TriangleAlert className="h-4 w-4 text-red-200" /> : <ShieldCheck className="h-4 w-4 text-teal-200" />}
        <span className="truncate text-sm font-semibold text-zinc-100">{execution.contender}</span>
        <StatusPill label={status} variant={completed ? "good" : failed ? "bad" : "warn"} />
        <span className="ml-auto font-mono text-xs text-zinc-500">{relativeTime(execution.timestamp)}</span>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <ProofLine label="Execution ID" value={shortId(execution.keeperhubSubmissionId, 12, 6)} />
        <ProofLine label="Trade ID" value={shortId(execution.tradeRecordId, 12, 6)} />
        <ProofLine label="Retries" value={String(execution.keeperhubRetryCount ?? 0)} />
        <ProofLine label="Mode" value={execution.executionMode ?? "unknown"} />
        <ProofLine label="Sold" value={`${formatNumber(execution.sold.amount, 8)} ${execution.sold.token}`} />
        <ProofLine label="Bought" value={`${formatNumber(execution.bought.amount, 8)} ${execution.bought.token}`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-mono">tx {shortId(execution.onChainTxHash)}</span>
        {href ? (
          <a className="inline-flex items-center gap-1 text-teal-200 hover:text-teal-100" href={href} target="_blank" rel="noreferrer">
            Etherscan <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {execution.lastExecutionError ? <span className="text-red-200">{execution.lastExecutionError}</span> : null}
      </div>
      {execution.executionReceipt ? (
        <details className="mt-3 border border-white/10 bg-black/20 p-2 text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">Receipt payload</summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(execution.executionReceipt, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

function ProofLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-black/20 px-3 py-2">
      <div className="label">{label}</div>
      <div className="mt-1 truncate font-mono text-zinc-200">{value || "-"}</div>
    </div>
  );
}
