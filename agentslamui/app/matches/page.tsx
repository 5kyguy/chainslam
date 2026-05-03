"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { BentoCell, BentoGrid } from "@/components/agentslam/BentoGrid";
import { Tag } from "@/components/agentslam/Tags";
import { formatInt } from "@/lib/format";
import {
  createAgent,
  createMatch,
  listAgents,
  listMatches,
  listStrategies,
  type AgentState,
  type MatchState,
  type StrategyOption,
} from "@/lib/api";
import { matchToMeta } from "@/lib/live-adapters";

const fieldStyle = {
  width: "100%",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--t1)",
  padding: "9px 10px",
} satisfies CSSProperties;

export default function MatchesPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [agentAId, setAgentAId] = useState("new");
  const [agentBId, setAgentBId] = useState("new");
  const [strategyA, setStrategyA] = useState("momentum");
  const [strategyB, setStrategyB] = useState("mean_reverter");
  const [nameA, setNameA] = useState("Momentum Trader");
  const [nameB, setNameB] = useState("Mean Reverter");
  const [tokenPair, setTokenPair] = useState("WETH/USDC");
  const [capital, setCapital] = useState(1000);
  const [duration, setDuration] = useState(300);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [nextStrategies, nextAgents, nextMatches] = await Promise.all([
        listStrategies(),
        listAgents(),
        listMatches(),
      ]);
      setStrategies(nextStrategies);
      setAgents(nextAgents);
      setMatches(nextMatches);
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

  const readyAgents = agents.filter((agent) => agent.status === "ready");
  const totalPool = matches.reduce((sum, match) => sum + match.contenders.A.startingCapitalUsd + match.contenders.B.startingCapitalUsd, 0);
  const runningCount = matches.filter((match) => match.status === "running").length;
  const sortedMatches = useMemo(
    () => [...matches].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [matches],
  );

  async function resolveAgent(selection: string, name: string, strategy: string) {
    if (selection !== "new") {
      const existing = agents.find((agent) => agent.id === selection);
      if (!existing) throw new Error("Selected agent no longer exists");
      return existing;
    }

    return createAgent({
      name,
      strategy,
      riskTolerance: strategy === "momentum" ? 0.7 : strategy === "mean_reverter" ? 0.45 : 0.55,
      personality: "Hackathon demo contender",
    });
  }

  async function startMatch() {
    setSubmitting(true);
    setError(null);

    try {
      const [agentA, agentB] = await Promise.all([
        resolveAgent(agentAId, nameA, strategyA),
        resolveAgent(agentBId, nameB, strategyB),
      ]);

      if (agentA.id === agentB.id) {
        throw new Error("Choose two different agents for a fair match");
      }

      const match = await createMatch({
        agentA: agentA.id,
        agentB: agentB.id,
        tokenPair,
        startingCapitalUsd: capital,
        durationSeconds: duration,
      });

      router.push(`/matches/${match.id}/arena`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start match");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bento-wrap" style={{ paddingTop: 20 }}>
      <BentoGrid cols="bento-12">
        <BentoCell className="s8 cell-dark">
          <div className="cell-title lg">Matches Command Center</div>
          <p className="body-sm mt8">
            Create two backend agents, start a real referee-run match, then watch decisions, trades, and proof data stream into the arena.
          </p>
          {error && <p className="body-xs mt8" style={{ color: "var(--berserk)" }}>{error}</p>}
        </BentoCell>
        <BentoCell className="s4">
          <div className="section-hed">Backend Today</div>
          <div className="big-stat stoic mt8">{loading ? "..." : matches.length}</div>
          <div className="body-xs">Stored Matches</div>
          <div className="big-stat gold mt12">${formatInt(totalPool)}</div>
          <div className="body-xs">{runningCount} running now</div>
        </BentoCell>
      </BentoGrid>

      <BentoGrid cols="bento-12" className="mt10">
        <BentoCell className="s12 cell-dark">
          <div className="section-row">
            <div className="section-hed">Start Hackathon Match</div>
            <button className="nbtn outline" type="button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          <div className="bento bento-12 mt10">
            <div className="cell s3">
              <div className="body-xs" style={{ marginBottom: 6 }}>Agent A</div>
              <select value={agentAId} onChange={(e) => setAgentAId(e.target.value)} style={fieldStyle}>
                <option value="new">Create new</option>
                {readyAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} ({agent.strategy})</option>
                ))}
              </select>
              {agentAId === "new" && (
                <>
                  <input value={nameA} onChange={(e) => setNameA(e.target.value)} style={{ ...fieldStyle, marginTop: 8 }} />
                  <select value={strategyA} onChange={(e) => setStrategyA(e.target.value)} style={{ ...fieldStyle, marginTop: 8 }}>
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className="cell s3">
              <div className="body-xs" style={{ marginBottom: 6 }}>Agent B</div>
              <select value={agentBId} onChange={(e) => setAgentBId(e.target.value)} style={fieldStyle}>
                <option value="new">Create new</option>
                {readyAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} ({agent.strategy})</option>
                ))}
              </select>
              {agentBId === "new" && (
                <>
                  <input value={nameB} onChange={(e) => setNameB(e.target.value)} style={{ ...fieldStyle, marginTop: 8 }} />
                  <select value={strategyB} onChange={(e) => setStrategyB(e.target.value)} style={{ ...fieldStyle, marginTop: 8 }}>
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className="cell s2">
              <div className="body-xs" style={{ marginBottom: 6 }}>Pair</div>
              <input value={tokenPair} onChange={(e) => setTokenPair(e.target.value)} style={fieldStyle} />
            </div>
            <div className="cell s2">
              <div className="body-xs" style={{ marginBottom: 6 }}>Capital</div>
              <input type="number" min={1} value={capital} onChange={(e) => setCapital(Number(e.target.value))} style={fieldStyle} />
              <div className="body-xs" style={{ marginTop: 8, color: "var(--gold)" }}>
                Live Sepolia trades are capped by backend env; use higher capital for clearer PnL spread.
              </div>
            </div>
            <div className="cell s2">
              <div className="body-xs" style={{ marginBottom: 6 }}>Seconds</div>
              <input type="number" min={30} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={fieldStyle} />
              <button className="nbtn fill" type="button" disabled={submitting} onClick={() => void startMatch()} style={{ marginTop: 10, width: "100%" }}>
                {submitting ? "Starting..." : "Start"}
              </button>
            </div>
          </div>
        </BentoCell>
      </BentoGrid>

      <BentoGrid cols="bento-12" className="mt10">
        {sortedMatches.map((backendMatch) => {
          const match = matchToMeta(backendMatch);
          return (
            <BentoCell key={match.id} className="s4 clickable">
              <div className="section-row">
                <div className="section-hed">#{match.id}</div>
                <Tag variant={match.status === "live" ? "live" : match.status === "upcoming" ? "gold" : "purple"}>{match.status}</Tag>
              </div>
              <div className="cell-title" style={{ marginBottom: 8 }}>
                {match.left.name} vs {match.right.name}
              </div>
              <div className="body-xs" style={{ marginBottom: 8 }}>
                {match.title}
              </div>
              <div className="body-xs" style={{ marginBottom: 6 }}>
                {formatInt(match.viewers)} spectators
              </div>
              <div className="body-xs" style={{ marginBottom: 4 }}>
                Prize pool: ${formatInt(match.prize)}
              </div>
              <div className="body-xs" style={{ marginBottom: 4 }}>
                PnL: {backendMatch.contenders.A.pnlPct}% / {backendMatch.contenders.B.pnlPct}%
              </div>
              <div className="bar-wrap" style={{ marginBottom: 12 }}>
                <div className="bar-fill duo" style={{ width: `${match.vol}%` }} />
              </div>
              <div className="flex gap8">
                <Link className="nbtn outline" href={`/matches/${match.id}`}>
                  Detail
                </Link>
                <Link className="nbtn fill" href={`/matches/${match.id}/arena`}>
                  Arena
                </Link>
                <Link className="nbtn outline" href={`/matches/${match.id}/recap`}>
                  Recap
                </Link>
              </div>
            </BentoCell>
          );
        })}
        {!loading && sortedMatches.length === 0 && (
          <BentoCell className="s12">
            <div className="section-hed">No backend matches yet</div>
            <p className="body-sm mt8">Start a match above once the backend is running.</p>
          </BentoCell>
        )}
      </BentoGrid>
    </div>
  );
}
