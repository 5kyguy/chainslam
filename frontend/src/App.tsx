import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { AgentPanel } from "./components/AgentPanel";
import { EventFeed } from "./components/EventFeed";
import { ExecutionProof } from "./components/ExecutionProof";
import { HistoryPanel } from "./components/HistoryPanel";
import { LeaderboardPanel } from "./components/LeaderboardPanel";
import { MatchHeader } from "./components/MatchHeader";
import { MemoryProof } from "./components/MemoryProof";
import { SetupForm } from "./components/SetupForm";
import { StatusPill } from "./components/StatusPill";
import { API_BASE_URL, api } from "./api/client";
import { connectMatchSocket } from "./api/ws";
import type {
  DecisionEvent,
  FeedEvent,
  KeeperHubExecutionAudit,
  LeaderboardEntry,
  MatchState,
  MatchStatus,
  MemoryPage,
  SeriesPoint,
  StartMatchInput,
  StrategyOption,
  TradeEvent,
  WsEnvelope,
  WsStatus,
  ZeroGSnapshot,
} from "./types";
import { cn, formatPct, formatUsd, mergeFeed, winnerSide } from "./utils";

function App() {
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [activeMatch, setActiveMatch] = useState<MatchState | null>(null);
  const [activeStrategyIds, setActiveStrategyIds] = useState<{ A?: string; B?: string }>({});
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [executions, setExecutions] = useState<KeeperHubExecutionAudit[]>([]);
  const [memory, setMemory] = useState<MemoryPage | null>(null);
  const [zeroG, setZeroG] = useState<ZeroGSnapshot | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [historyFilter, setHistoryFilter] = useState<MatchStatus | undefined>();
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const strategiesById = useMemo(() => new Map(strategies.map((strategy) => [strategy.id, strategy])), [strategies]);

  const appendSnapshotPoint = useCallback((match: MatchState) => {
    setSeries((current) => {
      const t = new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
      const next = [
        ...current,
        {
          t,
          A: match.contenders.A.pnlPct,
          B: match.contenders.B.pnlPct,
          price: match.ethPrice,
        },
      ];
      return next.slice(-80);
    });
  }, []);

  const loadStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    try {
      const result = await api.getStrategies();
      setStrategies(result);
      setGlobalError(null);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to load strategies");
    } finally {
      setStrategiesLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      setLeaderboard(await api.getLeaderboard());
    } catch (err) {
      console.warn("[leaderboard] load failed", err);
    }
  }, []);

  const loadHistory = useCallback(async (status?: MatchStatus) => {
    setHistoryLoading(true);
    try {
      setMatches(await api.listMatches({ status, limit: 50 }));
    } catch (err) {
      console.warn("[history] load failed", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadProof = useCallback(async (matchId: string) => {
    setProofLoading(true);
    try {
      const [executionResult, memoryResult, zeroGResult] = await Promise.allSettled([
        api.getExecutions(matchId),
        api.getMemory(matchId),
        api.getZeroGMemory(matchId),
      ]);

      if (executionResult.status === "fulfilled") setExecutions(executionResult.value);
      if (memoryResult.status === "fulfilled") setMemory(memoryResult.value);
      if (zeroGResult.status === "fulfilled") setZeroG(zeroGResult.value);
    } finally {
      setProofLoading(false);
    }
  }, []);

  const loadMatchDetail = useCallback(async (matchId: string, resetSeries = false) => {
    setRefreshing(true);
    try {
      const [match, persistedFeed] = await Promise.all([api.getMatch(matchId), api.getFeed(matchId)]);
      setActiveMatch(match);
      setFeed(mergeFeed([], persistedFeed));
      if (resetSeries) {
        setSeries([
          {
            t: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
            A: match.contenders.A.pnlPct,
            B: match.contenders.B.pnlPct,
            price: match.ethPrice,
          },
        ]);
      } else {
        appendSnapshotPoint(match);
      }
      await loadProof(matchId);
      setGlobalError(null);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to refresh match");
    } finally {
      setRefreshing(false);
    }
  }, [appendSnapshotPoint, loadProof]);

  useEffect(() => {
    void loadStrategies();
    void loadLeaderboard();
  }, [loadLeaderboard, loadStrategies]);

  useEffect(() => {
    void loadHistory(historyFilter);
  }, [historyFilter, loadHistory]);

  const handleWsMessage = useCallback((message: WsEnvelope) => {
    if (message.event === "snapshot" || message.event === "completed" || message.event === "stopped") {
      if (isMatchState(message.payload)) {
        setActiveMatch(message.payload);
        appendSnapshotPoint(message.payload);
        if (message.payload.status === "completed" || message.payload.status === "stopped") {
          void loadLeaderboard();
          void loadHistory(historyFilter);
          void loadProof(message.payload.id);
        }
      }
      return;
    }

    if (message.event === "decision" && isDecisionEvent(message.payload)) {
      const event = message.payload;
      setFeed((current) => mergeFeed(current, [event]));
      return;
    }

    if (message.event === "trade_executed" && isTradeEventPayload(message.payload)) {
      const event = message.payload;
      setFeed((current) => mergeFeed(current, [event]));
      void loadProof(message.match_id);
    }
  }, [appendSnapshotPoint, historyFilter, loadHistory, loadLeaderboard, loadProof]);

  useEffect(() => {
    if (!activeMatch?.id) {
      setWsStatus("idle");
      return undefined;
    }

    return connectMatchSocket(activeMatch.id, {
      onMessage: handleWsMessage,
      onStatus: setWsStatus,
      onError: () => setGlobalError("Match WebSocket disconnected. The UI will keep polling REST data."),
    });
  }, [activeMatch?.id, handleWsMessage]);

  useEffect(() => {
    if (!activeMatch?.id) return undefined;
    const id = window.setInterval(() => {
      void api.getMatch(activeMatch.id).then((match) => {
        setActiveMatch(match);
        appendSnapshotPoint(match);
      }).catch(() => undefined);
      void loadProof(activeMatch.id);
    }, 5000);
    return () => window.clearInterval(id);
  }, [activeMatch?.id, appendSnapshotPoint, loadProof]);

  const startMatch = async (input: StartMatchInput) => {
    setStarting(true);
    setSetupError(null);
    setGlobalError(null);
    try {
      const a = strategiesById.get(input.strategyA);
      const b = strategiesById.get(input.strategyB);
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
      const [agentA, agentB] = await Promise.all([
        api.createAgent({
          name: `${a?.name ?? input.strategyA} A ${stamp}`,
          strategy: input.strategyA,
          riskTolerance: riskToleranceFor(a),
          personality: input.demoMode ? "Safe Sepolia Canary challenger" : "Arena challenger",
        }),
        api.createAgent({
          name: `${b?.name ?? input.strategyB} B ${stamp}`,
          strategy: input.strategyB,
          riskTolerance: riskToleranceFor(b),
          personality: input.demoMode ? "Safe Sepolia Canary challenger" : "Arena challenger",
        }),
      ]);

      const match = await api.createMatch({
        agentA: agentA.id,
        agentB: agentB.id,
        tokenPair: input.tokenPair,
        startingCapitalUsd: input.startingCapitalUsd,
        durationSeconds: input.durationSeconds,
      });

      setActiveStrategyIds({ A: input.strategyA, B: input.strategyB });
      setActiveMatch(match);
      setFeed([]);
      setExecutions([]);
      setMemory(null);
      setZeroG(null);
      setSeries([
        {
          t: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
          A: match.contenders.A.pnlPct,
          B: match.contenders.B.pnlPct,
          price: match.ethPrice,
        },
      ]);
      await Promise.all([loadProof(match.id), loadHistory(historyFilter), loadLeaderboard()]);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to start match");
    } finally {
      setStarting(false);
    }
  };

  const selectHistoryMatch = (match: MatchState) => {
    setActiveStrategyIds({});
    setActiveMatch(match);
    setWsStatus("connecting");
    void loadMatchDetail(match.id, true);
  };

  const refreshActive = () => {
    if (activeMatch?.id) {
      void loadMatchDetail(activeMatch.id);
    } else {
      void loadStrategies();
      void loadHistory(historyFilter);
      void loadLeaderboard();
    }
  };

  const stopActive = async () => {
    if (!activeMatch || activeMatch.status !== "running") return;
    setRefreshing(true);
    try {
      const stopped = await api.stopMatch(activeMatch.id);
      setActiveMatch(stopped);
      await Promise.all([loadProof(stopped.id), loadHistory(historyFilter), loadLeaderboard()]);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to stop match");
    } finally {
      setRefreshing(false);
    }
  };

  const strategyA = activeStrategyIds.A ? strategiesById.get(activeStrategyIds.A) : inferStrategy(activeMatch?.contenders.A.name, strategies);
  const strategyB = activeStrategyIds.B ? strategiesById.get(activeStrategyIds.B) : inferStrategy(activeMatch?.contenders.B.name, strategies);
  const winner = winnerSide(activeMatch);

  return (
    <div className="min-h-screen bg-terminal-950">
      <header className="border-b border-white/10 bg-terminal-950/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-teal-300/40 bg-teal-400/10">
              <Activity className="h-5 w-5 text-teal-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-zinc-50">Agent Slam</h1>
                <StatusPill label="demo cockpit" variant="live" />
              </div>
              <p className="truncate font-mono text-xs text-zinc-500">{API_BASE_URL}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={strategies.length ? "backend online" : "backend pending"} variant={strategies.length ? "good" : "warn"} />
            <button type="button" className="text-button" onClick={refreshActive} disabled={refreshing || strategiesLoading} title="Refresh cockpit data">
              <RefreshCw className={cn("h-4 w-4", (refreshing || strategiesLoading) && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-4 overflow-x-hidden px-4 py-4 sm:px-6">
        {globalError ? (
          <div className="flex items-start gap-3 border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <Server className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{globalError}</span>
          </div>
        ) : null}

        <MatchHeader match={activeMatch} wsStatus={wsStatus} refreshing={refreshing} onRefresh={refreshActive} onStop={stopActive} />

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)_430px]">
          <aside className="grid min-w-0 grid-cols-1 content-start gap-4">
            <SetupForm strategies={strategies} loading={strategiesLoading} starting={starting} error={setupError} onStart={startMatch} />
            <LeaderboardPanel entries={leaderboard} />
          </aside>

          <section className="grid min-w-0 grid-cols-1 content-start gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <AgentPanel
                side="A"
                contender={activeMatch?.contenders.A}
                strategy={strategyA}
                status={activeMatch?.status ?? "standby"}
                series={series}
                isWinner={winner === "A"}
              />
              <AgentPanel
                side="B"
                contender={activeMatch?.contenders.B}
                strategy={strategyB}
                status={activeMatch?.status ?? "standby"}
                series={series}
                isWinner={winner === "B"}
              />
            </div>

            <section className="panel min-w-0 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <CockpitMetric label="Pair" value={activeMatch?.tokenPair ?? "-"} />
                <CockpitMetric label="Capital" value={activeMatch ? formatUsd(activeMatch.startingCapitalUsd, 0) : "-"} />
                <CockpitMetric label="Agent A PnL" value={formatPct(activeMatch?.contenders.A.pnlPct)} tone={(activeMatch?.contenders.A.pnlPct ?? 0) >= 0 ? "text-emerald-200" : "text-red-200"} />
                <CockpitMetric label="Agent B PnL" value={formatPct(activeMatch?.contenders.B.pnlPct)} tone={(activeMatch?.contenders.B.pnlPct ?? 0) >= 0 ? "text-emerald-200" : "text-red-200"} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border border-white/10 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                <ShieldCheck className="h-4 w-4 text-teal-300" />
                <span>Frontend never handles private keys or token approvals. KeeperHub proof reflects backend execution state only.</span>
              </div>
            </section>

            <EventFeed events={feed} wsStatus={wsStatus} />
          </section>

          <aside className="grid min-w-0 grid-cols-1 content-start gap-4">
            <ExecutionProof executions={executions} loading={proofLoading} onRefresh={() => activeMatch?.id && void loadProof(activeMatch.id)} />
            <MemoryProof memory={memory} zeroG={zeroG} loading={proofLoading} onRefresh={() => activeMatch?.id && void loadProof(activeMatch.id)} />
            <HistoryPanel
              matches={matches}
              filter={historyFilter}
              loading={historyLoading}
              onFilterChange={setHistoryFilter}
              onSelect={selectHistoryMatch}
              onRefresh={() => void loadHistory(historyFilter)}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}

function CockpitMetric({ label, value, tone = "text-zinc-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="panel-inset min-w-0 p-3">
      <div className="label">{label}</div>
      <div className={cn("mt-1 truncate font-mono text-lg font-semibold", tone)}>{value}</div>
    </div>
  );
}

function riskToleranceFor(strategy?: StrategyOption): number {
  const risk = strategy?.riskProfile.toLowerCase() ?? "";
  if (risk.includes("low")) return 0.25;
  if (risk.includes("medium-high")) return 0.72;
  if (risk.includes("medium")) return 0.55;
  if (risk.includes("chaos")) return 0.95;
  return 0.5;
}

function inferStrategy(name: string | undefined, strategies: StrategyOption[]): StrategyOption | undefined {
  if (!name) return undefined;
  const normalized = name.toLowerCase();
  return strategies.find((strategy) => normalized.includes(strategy.name.toLowerCase()) || normalized.includes(strategy.id.toLowerCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMatchState(value: unknown): value is MatchState {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.contenders);
}

function isDecisionEvent(value: unknown): value is DecisionEvent {
  return isRecord(value) && value.event === "decision" && typeof value.contender === "string" && typeof value.action === "string";
}

function isTradeEventPayload(value: unknown): value is TradeEvent {
  return isRecord(value) && value.event === "trade_executed" && typeof value.contender === "string";
}

export default App;
