import { FormEvent, useEffect, useMemo, useState } from "react";
import { Play, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { StartMatchInput, StrategyOption } from "../types";
import { cn } from "../utils";

interface SetupFormProps {
  strategies: StrategyOption[];
  loading: boolean;
  starting: boolean;
  error?: string | null;
  onStart: (input: StartMatchInput) => void;
}

const pairs = ["WETH/USDC", "WETH/USDT", "WBTC/USDC", "UNI/USDC", "LINK/USDC"];

export function SetupForm({ strategies, loading, starting, error, onStart }: SetupFormProps) {
  const [strategyA, setStrategyA] = useState("dca");
  const [strategyB, setStrategyB] = useState("momentum");
  const [tokenPair, setTokenPair] = useState("WETH/USDC");
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [startingCapitalUsd, setStartingCapitalUsd] = useState(100);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (!strategies.length) return;
    setStrategyA((current) => (strategies.some((s) => s.id === current) ? current : strategies[0]?.id ?? ""));
    setStrategyB((current) => {
      if (strategies.some((s) => s.id === current)) return current;
      return strategies[1]?.id ?? strategies[0]?.id ?? "";
    });
  }, [strategies]);

  const byId = useMemo(() => new Map(strategies.map((strategy) => [strategy.id, strategy])), [strategies]);

  const applyCanary = () => {
    setStrategyA("dca");
    setStrategyB("momentum");
    setTokenPair("WETH/USDC");
    setDurationSeconds(30);
    setStartingCapitalUsd(1);
    setDemoMode(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart({
      strategyA,
      strategyB,
      tokenPair,
      durationSeconds,
      startingCapitalUsd,
      demoMode,
    });
  };

  return (
    <form onSubmit={submit} className="panel flex w-full min-w-0 flex-col">
      <div className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="label">Match Setup</p>
            <h2 className="truncate text-lg font-semibold text-zinc-100">Strategy Selection</h2>
          </div>
          <button type="button" className="icon-button shrink-0 sm:h-9 sm:w-auto sm:px-3" onClick={applyCanary} title="Apply Safe Sepolia Canary preset">
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Canary</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4">
        <StrategySelect
          side="A"
          value={strategyA}
          onChange={setStrategyA}
          strategies={strategies}
          selected={byId.get(strategyA)}
          disabled={loading || starting}
        />
        <StrategySelect
          side="B"
          value={strategyB}
          onChange={setStrategyB}
          strategies={strategies}
          selected={byId.get(strategyB)}
          disabled={loading || starting}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 sm:col-span-1">
            <span className="label">Pair</span>
            <select className="input" value={tokenPair} onChange={(event) => setTokenPair(event.target.value)} disabled={starting}>
              {pairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pair}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="label">Duration</span>
            <select
              className="input"
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              disabled={starting}
            >
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2m</option>
              <option value={300}>5m</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="label">Capital</span>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={startingCapitalUsd}
              onChange={(event) => setStartingCapitalUsd(Number(event.target.value))}
              disabled={starting}
            />
          </label>
        </div>

        <label className="panel-inset flex cursor-pointer items-start gap-3 p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-teal-400"
            checked={demoMode}
            onChange={(event) => setDemoMode(event.target.checked)}
            disabled={starting}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <SlidersHorizontal className="h-4 w-4 text-teal-300" />
              Demo mode
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-400">
              Safe Sepolia Canary expects the backend env to already have live mode, KeeperHub wallet, balances, and allowances configured.
            </span>
          </span>
        </label>

        {error ? <div className="border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}

        <button
          type="submit"
          className={cn("primary-button w-full", starting && "animate-pulse")}
          disabled={loading || starting || strategies.length < 2 || !strategyA || !strategyB}
        >
          <Play className="h-4 w-4" />
          {starting ? "Starting Match" : "Start Match"}
        </button>
      </div>
    </form>
  );
}

function StrategySelect({
  side,
  value,
  onChange,
  strategies,
  selected,
  disabled,
}: {
  side: "A" | "B";
  value: string;
  onChange: (value: string) => void;
  strategies: StrategyOption[];
  selected?: StrategyOption;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2">
      <span className="label">Strategy {side}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {strategies.map((strategy) => (
          <option key={strategy.id} value={strategy.id}>
            {strategy.name} - {strategy.riskProfile}
          </option>
        ))}
      </select>
      <span className="min-h-[44px] border border-white/10 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
        <span className="font-semibold text-zinc-200">{selected?.riskProfile ?? "Loading"}</span>
        {selected ? ` risk. ${selected.description}` : " strategies from backend."}
      </span>
    </label>
  );
}
