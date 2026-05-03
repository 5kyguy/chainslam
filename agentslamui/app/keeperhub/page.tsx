"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BentoCell, BentoGrid } from "@/components/agentslam/BentoGrid";
import { StatRow } from "@/components/agentslam/StatRow";
import { Tag } from "@/components/agentslam/Tags";
import { formatMoney } from "@/lib/format";
import {
  getExecutions,
  listMatches,
  type KeeperHubExecutionAudit,
  type MatchState,
} from "@/lib/api";

type ExecutionRow = KeeperHubExecutionAudit & {
  match: MatchState;
};

function statusVariant(status?: string) {
  if (status === "completed") return "live" as const;
  if (status === "failed") return "berserk" as const;
  if (status === "running") return "gold" as const;
  return "purple" as const;
}

function shortId(value?: string) {
  if (!value) return "pending";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export default function KeeperHubPage() {
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const nextMatches = await listMatches();
      const recent = [...nextMatches]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 25);
      const executionGroups = await Promise.all(
        recent.map(async (match) => {
          const rows = await getExecutions(match.id).catch(() => []);
          return rows.map((row) => ({ ...row, match }));
        }),
      );
      setMatches(recent);
      setExecutions(executionGroups.flat());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const completed = executions.filter((execution) => execution.keeperhubStatus === "completed");
  const failed = executions.filter((execution) => execution.keeperhubStatus === "failed" || execution.lastExecutionError);
  const liveNotional = executions.reduce((sum, execution) => {
    const sold = execution.sold.token.toUpperCase() === "USDC" ? execution.sold.amount : 0;
    return sum + sold;
  }, 0);

  const latest = useMemo(
    () =>
      [...executions].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [executions],
  );

  return (
    <div className="bento-wrap" style={{ paddingTop: 20 }}>
      <BentoGrid cols="bento-12">
        <BentoCell className="s8 cell-dark">
          <div className="cell-title lg">KeeperHub Execution Audit</div>
          <p className="body-sm mt8">
            Live Uniswap swap intents submitted through KeeperHub, with execution id, status, receipt, and Sepolia transaction proof.
          </p>
          {error && <p className="body-xs mt8" style={{ color: "var(--berserk)" }}>{error}</p>}
        </BentoCell>
        <BentoCell className="s4">
          <div className="section-hed">Proof Summary</div>
          <div className="mt10 flex-col gap8">
            <StatRow label="Recent matches scanned" value={loading ? "..." : matches.length} />
            <StatRow label="KeeperHub executions" value={executions.length} />
            <StatRow label="Completed" value={completed.length} />
            <StatRow label="Errors" value={failed.length} />
          </div>
        </BentoCell>
      </BentoGrid>

      <BentoGrid cols="bento-12" className="mt10">
        <BentoCell className="s4">
          <div className="big-stat stoic">{completed.length}</div>
          <div className="big-stat-label">Completed Executions</div>
        </BentoCell>
        <BentoCell className="s4">
          <div className="big-stat gold">${formatMoney(liveNotional)}</div>
          <div className="big-stat-label">USDC Routed Through Live Proofs</div>
        </BentoCell>
        <BentoCell className="s4">
          <div className="big-stat purple">{latest[0]?.keeperhubStatus ?? "waiting"}</div>
          <div className="big-stat-label">Latest KeeperHub Status</div>
        </BentoCell>
      </BentoGrid>

      <BentoGrid cols="bento-12" className="mt10">
        {latest.map((execution) => (
          <BentoCell key={execution.tradeRecordId} className="s6">
            <div className="section-row">
              <div className="section-hed">{execution.contender}</div>
              <Tag variant={statusVariant(execution.keeperhubStatus)}>{execution.keeperhubStatus ?? "pending"}</Tag>
            </div>
            <div className="mt10 flex-col gap8">
              <StatRow label="Match" value={<Link href={`/matches/${execution.match.id}/arena`} className="section-link">{execution.match.id}</Link>} />
              <StatRow label="Execution id" value={shortId(execution.keeperhubSubmissionId)} />
              <StatRow label="Mode" value={execution.executionMode ?? "unknown"} />
              <StatRow label="Sold" value={`${execution.sold.amount} ${execution.sold.token}`} />
              <StatRow label="Bought" value={`${execution.bought.amount} ${execution.bought.token}`} />
              <StatRow label="Retries" value={execution.keeperhubRetryCount ?? 0} />
              {execution.onChainTxHash && <StatRow label="Tx" value={shortId(execution.onChainTxHash)} />}
            </div>
            <div className="flex gap8 mt12" style={{ flexWrap: "wrap" }}>
              <Link className="nbtn outline" href={`/matches/${execution.match.id}/arena`}>
                Arena
              </Link>
              {execution.keeperhubTransactionLink && (
                <a className="nbtn fill" href={execution.keeperhubTransactionLink} target="_blank" rel="noreferrer">
                  Sepolia Tx
                </a>
              )}
            </div>
            {execution.lastExecutionError && (
              <p className="body-xs mt10" style={{ color: "var(--berserk)" }}>{execution.lastExecutionError}</p>
            )}
          </BentoCell>
        ))}
        {!loading && latest.length === 0 && (
          <BentoCell className="s12">
            <div className="section-hed">No KeeperHub executions yet</div>
            <p className="body-sm mt8">
              Start a live Sepolia match with DCA Bot and stop after the first `uniswap_live_swap` trade.
            </p>
          </BentoCell>
        )}
      </BentoGrid>
    </div>
  );
}
