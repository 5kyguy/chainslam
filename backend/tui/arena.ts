import "../src/load-env.js";
import blessed from "blessed";
import WebSocket from "ws";

const BASE_URL = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ?? "http://127.0.0.1:8787";
const STRATEGY_A = process.argv.find((a) => a.startsWith("--strategy-a="))?.split("=")[1] ?? "momentum";
const STRATEGY_B = process.argv.find((a) => a.startsWith("--strategy-b="))?.split("=")[1] ?? "mean_reverter";
const DURATION = parseInt(process.argv.find((a) => a.startsWith("--duration="))?.split("=")[1] ?? "120", 10);
const CAPITAL = parseInt(
  process.argv.find((a) => a.startsWith("--capital="))?.split("=")[1]
    ?? process.env.DEFAULT_PER_AGENT_STARTING_CAPITAL_USD
    ?? "1000",
  10,
);
const TOKEN_PAIR = process.argv.find((a) => a.startsWith("--pair="))?.split("=")[1] ?? "WETH/USDC";

const STRATEGY_NAMES: Record<string, string> = {
  dca: "DCA Bot",
  momentum: "Momentum Trader",
  mean_reverter: "Mean Reverter",
  fear_greed: "Fear & Greed",
  grid: "Grid Trader",
  random: "Random Walk",
};

const TOKEN_PAIRS = [
  "WETH/USDC",
  "WBTC/USDC",
  "WETH/USDT",
  "UNI/USDC",
  "LINK/USDC",
  "WETH/DAI",
];

const DURATION_PRESETS = [
  { label: "60s  (1 min)", value: 60 },
  { label: "120s (2 min)", value: 120 },
  { label: "300s (5 min)", value: 300 },
  { label: "600s (10 min)", value: 600 },
];

const wsUrl = BASE_URL.replace(/^http/, "ws");
const STRATEGY_KEYS = Object.keys(STRATEGY_NAMES);

const OUTCOME_RELATIVE_PNL_TOLERANCE_PCT = 0.25;
const OUTCOME_PORTFOLIO_USD_EPS = 0.005;

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface MatchPayload {
  id: string;
  status: string;
  tokenPair: string;
  ethPrice: number;
  timeRemainingSeconds: number;
  startingCapitalUsd: number;
  contenders: {
    A: { name: string; pnlPct: number; portfolioUsd: number; trades: number; startingCapitalUsd?: number };
    B: { name: string; pnlPct: number; portfolioUsd: number; trades: number; startingCapitalUsd?: number };
  };
}

interface Envelope {
  event: string;
  match_id: string;
  timestamp: string;
  payload: unknown;
}

interface TradePayload {
  contender: string;
  sold: { token: string; amount: number };
  bought: { token: string; amount: number };
  gasUsd: number;
  executionMode?: string;
  keeperhubSubmissionId?: string;
  keeperhubStatus?: string;
  keeperhubRetryCount?: number;
  onChainTxHash?: string;
  keeperhubTransactionLink?: string;
  lastExecutionError?: string;
}

interface StrategyOption {
  id: string;
  name: string;
  riskProfile: string;
  description: string;
}

interface LeaderboardEntry {
  rank: number;
  strategy: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  avgPnlPct: number;
  matchesPlayed: number;
}

function pnlStr(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  const arrow = pct > 0.1 ? " ▲" : pct < -0.1 ? " ▼" : "";
  return `{${pct >= 0 ? "green-fg" : "red-fg"}}${sign}${pct.toFixed(2)}%${arrow}{/}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function keeperHubStatusColor(status?: string, error?: string): string {
  if (error) return "red-fg";
  const normalized = (status ?? "").trim().toLowerCase();
  if (["completed", "complete", "success", "succeeded", "executed", "mined"].includes(normalized)) {
    return "green-fg";
  }
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "rejected", "expired", "timeout", "timed_out"].includes(normalized)) {
    return "red-fg";
  }
  if (["queued", "created", "submitted", "pending", "running", "processing", "executing", "in_progress"].includes(normalized)) {
    return "yellow-fg";
  }
  return "cyan-fg";
}

function cleanupKeys(screen: blessed.Widgets.Screen, bindings: Record<string, () => void>) {
  for (const key of Object.keys(bindings)) {
    screen.unkey(key, bindings[key]);
  }
}

type ScreenPhase = "menu" | "strategies" | "config" | "review" | "live" | "results" | "leaderboard";

function showMainMenu(screen: blessed.Widgets.Screen): Promise<"new_match" | "leaderboard" | "quit"> {
  return new Promise((resolve) => {
    const items = ["New Match", "Leaderboard", "Quit"];

    const box = blessed.box({
      top: "center",
      left: "center",
      width: 50,
      height: 10,
      tags: true,
      label: " AGENT SLAM ",
      border: { type: "line" },
      style: { border: { fg: "cyan" }, bg: "black" },
    });

    const title = blessed.box({
      parent: box,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 2,
      tags: true,
      align: "center",
      content: "{bold}{cyan-fg}AGENT SLAM ARENA{/}{/}\n{grey-fg}AI vs AI DeFi Trading{/}",
    });

    const list = blessed.list({
      parent: box,
      top: 3,
      left: 1,
      width: "100%-2",
      height: 5,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "cyan", fg: "black" },
        item: { fg: "white" },
      },
      items,
    });

    list.select(0);
    screen.append(box);
    list.focus();
    screen.render();

    const onEnter = () => {
      const idx = (list as unknown as { selected: number }).selected;
      cleanupKeys(screen, { enter: onEnter, q: onQuit });
      box.destroy();
      screen.render();
      if (idx === 0) resolve("new_match");
      else if (idx === 1) resolve("leaderboard");
      else resolve("quit");
    };

    const onQuit = () => {
      cleanupKeys(screen, { enter: onEnter, q: onQuit });
      box.destroy();
      screen.render();
      resolve("quit");
    };

    screen.key("enter", onEnter);
    screen.key("q", onQuit);
  });
}

function selectStrategies(
  screen: blessed.Widgets.Screen,
  strategies: StrategyOption[],
): Promise<{ strategyA: string; strategyB: string }> {
  const defaultA = Math.max(0, strategies.findIndex((s) => s.id === STRATEGY_A));
  const defaultB = Math.max(0, strategies.findIndex((s) => s.id === STRATEGY_B));
  const strategyLabel = (s: StrategyOption) => `${s.name} (${s.id}) — ${s.riskProfile}`;

  return new Promise((resolve) => {
    const overlay = blessed.box({
      top: "center",
      left: "center",
      width: "90%",
      height: 17,
      tags: true,
      label: " SELECT AGENTS ",
      border: { type: "line" },
      style: { border: { fg: "cyan" }, bg: "black" },
    });

    const title = blessed.box({
      parent: overlay,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 2,
      tags: true,
      content: "{bold}Choose two agents, then press Enter{/bold}",
    });

    const listA = blessed.list({
      parent: overlay,
      top: 2,
      left: 1,
      width: "50%-2",
      height: 11,
      border: { type: "line" },
      label: " AGENT A ",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "yellow", fg: "black" },
        item: { fg: "white" },
      },
      items: strategies.map(strategyLabel),
    });

    const listB = blessed.list({
      parent: overlay,
      top: 2,
      left: "50%",
      width: "50%-1",
      height: 11,
      border: { type: "line" },
      label: " AGENT B ",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "magenta", fg: "black" },
        item: { fg: "white" },
      },
      items: strategies.map(strategyLabel),
    });

    const footer = blessed.box({
      parent: overlay,
      bottom: 0,
      left: 1,
      width: "100%-2",
      height: 2,
      tags: true,
      content: "{grey-fg}tab: switch list  ↑/↓: choose  enter: confirm  esc: back{/grey-fg}",
    });

    listA.select(defaultA);
    listB.select(defaultB);
    listA.focus();
    screen.append(overlay);
    screen.render();

    let activeList: "A" | "B" = "A";

    const toggleFocus = () => {
      activeList = activeList === "A" ? "B" : "A";
      (activeList === "A" ? listA : listB).focus();
      screen.render();
    };

    const onTab = () => toggleFocus();
    const onEnter = () => {
      const idxA = (listA as unknown as { selected: number }).selected;
      const idxB = (listB as unknown as { selected: number }).selected;
      doCleanup();
      resolve({ strategyA: strategies[idxA].id, strategyB: strategies[idxB].id });
    };
    const onEsc = () => {
      doCleanup();
      resolve({ strategyA: "", strategyB: "" });
    };

    const doCleanup = () => {
      cleanupKeys(screen, { tab: onTab, enter: onEnter, escape: onEsc });
      overlay.destroy();
      screen.render();
    };

    screen.key("tab", onTab);
    screen.key("enter", onEnter);
    screen.key("escape", onEsc);
  });
}

interface MatchConfig {
  strategyA: string;
  strategyB: string;
  tokenPair: string;
  capital: number;
  durationSeconds: number;
}

function configureMatch(screen: blessed.Widgets.Screen, defaults: MatchConfig): Promise<MatchConfig | null> {
  return new Promise((resolve) => {
    let pairIdx = Math.max(0, TOKEN_PAIRS.indexOf(defaults.tokenPair));
    let durIdx = DURATION_PRESETS.findIndex((d) => d.value === defaults.durationSeconds);
    if (durIdx === -1) durIdx = 1;
    let capital = String(defaults.capital);

    const overlay = blessed.box({
      top: "center",
      left: "center",
      width: 60,
      height: 18,
      tags: true,
      label: " MATCH CONFIGURATION ",
      border: { type: "line" },
      style: { border: { fg: "cyan" }, bg: "black" },
    });

    const fields: blessed.Widgets.BoxElement[] = [];

    const pairLabel = blessed.box({
      parent: overlay,
      top: 1,
      left: 2,
      width: 20,
      height: 1,
      tags: true,
      content: "{bold}Token Pair:{/}",
    });
    fields.push(pairLabel);

    const pairList = blessed.list({
      parent: overlay,
      top: 2,
      left: 2,
      width: 24,
      height: 4,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: "line" },
      style: {
        selected: { bg: "cyan", fg: "black" },
        item: { fg: "white" },
        border: { fg: "grey" },
      },
      items: TOKEN_PAIRS,
    });
    pairList.select(pairIdx);
    fields.push(pairList as unknown as blessed.Widgets.BoxElement);

    const durLabel = blessed.box({
      parent: overlay,
      top: 1,
      left: 30,
      width: 26,
      height: 1,
      tags: true,
      content: "{bold}Duration:{/}",
    });
    fields.push(durLabel);

    const durList = blessed.list({
      parent: overlay,
      top: 2,
      left: 30,
      width: 26,
      height: 4,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: "line" },
      style: {
        selected: { bg: "cyan", fg: "black" },
        item: { fg: "white" },
        border: { fg: "grey" },
      },
      items: DURATION_PRESETS.map((d) => d.label),
    });
    durList.select(durIdx);
    fields.push(durList as unknown as blessed.Widgets.BoxElement);

    const capLabel = blessed.box({
      parent: overlay,
      top: 8,
      left: 2,
      width: 20,
      height: 1,
      tags: true,
      content: "{bold}Starting Capital ($):{/}",
    });
    fields.push(capLabel);

    const capInput = blessed.textbox({
      parent: overlay,
      top: 9,
      left: 2,
      width: 24,
      height: 3,
      border: { type: "line" },
      style: {
        border: { fg: "grey" },
        fg: "white",
        bg: "black",
        focus: { border: { fg: "cyan" } },
      },
      inputOnFocus: true,
    });
    capInput.setValue(capital);
    fields.push(capInput as unknown as blessed.Widgets.BoxElement);

    const footer = blessed.box({
      parent: overlay,
      bottom: 0,
      left: 1,
      width: "100%-2",
      height: 2,
      tags: true,
      content: "{grey-fg}tab: switch field  enter: confirm  esc: back{/grey-fg}",
    });
    fields.push(footer);

    let activeField = 0;
    const focusable = [pairList, durList, capInput];

    const setFocus = (idx: number) => {
      activeField = idx;
      focusable[idx].focus();
      screen.render();
    };

    screen.append(overlay);
    setFocus(0);

    const onTab = () => {
      setFocus((activeField + 1) % focusable.length);
    };

    const onEnter = () => {
      capital = capInput.getValue().trim();
      doCleanup();
      const parsed = parseInt(capital, 10);
      resolve({
        strategyA: defaults.strategyA,
        strategyB: defaults.strategyB,
        tokenPair: TOKEN_PAIRS[(pairList as unknown as { selected: number }).selected] ?? TOKEN_PAIRS[0],
        capital: Number.isFinite(parsed) && parsed > 0 ? parsed : 1000,
        durationSeconds: DURATION_PRESETS[(durList as unknown as { selected: number }).selected]?.value ?? 120,
      });
    };

    const onEsc = () => {
      doCleanup();
      resolve(null);
    };

    const doCleanup = () => {
      cleanupKeys(screen, { tab: onTab, enter: onEnter, escape: onEsc });
      overlay.destroy();
      screen.render();
    };

    screen.key("tab", onTab);
    screen.key("enter", onEnter);
    screen.key("escape", onEsc);
  });
}

function showReview(screen: blessed.Widgets.Screen, config: MatchConfig): Promise<boolean> {
  const nameA = STRATEGY_NAMES[config.strategyA] ?? config.strategyA;
  const nameB = STRATEGY_NAMES[config.strategyB] ?? config.strategyB;

  return new Promise((resolve) => {
    const lines = [
      `{bold}{center}MATCH CONFIGURATION{/}{/}`,
      ``,
      `  {bold}Agent A:{/}     ${nameA}`,
      `  {bold}Agent B:{/}     ${nameB}`,
      `  {bold}Token Pair:{/}  ${config.tokenPair}`,
      `  {bold}Capital:{/}     $${config.capital.toLocaleString()} each`,
      `  {bold}Duration:{/}    ${config.durationSeconds}s`,
      ``,
      `{center}{grey-fg}Enter: Start Match  │  Esc: Back{/}{/}`,
    ];

    const box = blessed.box({
      top: "center",
      left: "center",
      width: 52,
      height: lines.length + 4,
      tags: true,
      label: " REVIEW ",
      border: { type: "line" },
      style: { border: { fg: "cyan" }, bg: "black" },
      content: lines.join("\n"),
    });

    screen.append(box);
    screen.render();

    const onEnter = () => {
      cleanupKeys(screen, { enter: onEnter, escape: onEsc });
      box.destroy();
      screen.render();
      resolve(true);
    };

    const onEsc = () => {
      cleanupKeys(screen, { enter: onEnter, escape: onEsc });
      box.destroy();
      screen.render();
      resolve(false);
    };

    screen.key("enter", onEnter);
    screen.key("escape", onEsc);
  });
}

function showLeaderboard(screen: blessed.Widgets.Screen): Promise<void> {
  return new Promise((resolve) => {
    const overlay = blessed.box({
      top: "center",
      left: "center",
      width: "80%",
      height: 20,
      tags: true,
      label: " LEADERBOARD ",
      border: { type: "line" },
      style: { border: { fg: "cyan" }, bg: "black" },
    });

    const content = blessed.box({
      parent: overlay,
      top: 1,
      left: 1,
      width: "100%-2",
      height: "100%-4",
      tags: true,
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      scrollbar: { ch: "█", style: { fg: "cyan" } },
      content: "{grey-fg}Loading...{/}",
    });

    const footer = blessed.box({
      parent: overlay,
      bottom: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      tags: true,
      content: "{grey-fg}esc: back{/grey-fg}",
    });

    screen.append(overlay);
    content.focus();
    screen.render();

    const renderTable = (entries: LeaderboardEntry[]) => {
      if (entries.length === 0) {
        content.setContent("{grey-fg}No matches played yet.{/}");
        screen.render();
        return;
      }

      const header = ` {bold}#   Agent/Strategy         Rating  W   L   D   PnL%     Played{/}`;
      const sep = " {grey-fg}──  ─────────────────────  ─────  ──  ──  ──  ───────  ──────{/}";
      const rows = entries.map((e) => {
        const rankStr = String(e.rank).padStart(2);
        const name = e.strategy.length > 22 ? e.strategy.slice(0, 20) + ".." : e.strategy.padEnd(22);
        const rating = String(e.rating).padStart(5);
        const w = String(e.wins).padStart(2);
        const l = String(e.losses).padStart(2);
        const d = String(e.draws).padStart(2);
        const pnl = (e.avgPnlPct >= 0 ? "+" : "") + e.avgPnlPct.toFixed(2) + "%";
        const pnlColor = e.avgPnlPct >= 0 ? "green-fg" : "red-fg";
        const played = String(e.matchesPlayed).padStart(4);
        return ` ${rankStr}  ${name}  ${rating}  ${w}  ${l}  ${d}  {${pnlColor}}${pnl.padStart(7)}{/}  ${played}`;
      });

      content.setContent([header, sep, ...rows].join("\n"));
      screen.render();
    };

    api<LeaderboardEntry[]>("/api/leaderboard")
      .then(renderTable)
      .catch((err) => {
        content.setContent(`{red-fg}Error: ${err.message}{/}`);
        screen.render();
      });

    const onEsc = () => {
      cleanupKeys(screen, { escape: onEsc });
      overlay.destroy();
      screen.render();
      resolve();
    };

    screen.key("escape", onEsc);
  });
}

function runLiveMatch(
  screen: blessed.Widgets.Screen,
  config: MatchConfig,
): Promise<"new_match" | "leaderboard" | "quit"> {
  const nameA = STRATEGY_NAMES[config.strategyA] ?? config.strategyA;
  const nameB = STRATEGY_NAMES[config.strategyB] ?? config.strategyB;
  const capital = config.capital;

  return new Promise((resolve) => {
    const header = blessed.box({
      top: 0, left: 0, width: "100%", height: 3,
      tags: true,
      content: `{center}{bold}AGENT SLAM ARENA{/bold}{/center}`,
      border: { type: "line" },
      style: { border: { fg: "cyan" }, fg: "white", bg: "black" },
    });

    const panelA = blessed.box({
      top: 3, left: 0, width: "50%", height: 11,
      tags: true,
      label: " CONTENDER A ",
      border: { type: "line" },
      style: { border: { fg: "yellow" }, fg: "white" },
      content: `  {bold}${nameA}{/bold}\n  Waiting for match...`,
    });

    const panelB = blessed.box({
      top: 3, left: "50%", width: "50%", height: 11,
      tags: true,
      label: " CONTENDER B ",
      border: { type: "line" },
      style: { border: { fg: "magenta" }, fg: "white" },
      content: `  {bold}${nameB}{/bold}\n  Waiting for match...`,
    });

    const feedBox = blessed.log({
      top: 14, left: 0, width: "100%", height: "100%-16",
      tags: true,
      label: " LIVE FEED ",
      border: { type: "line" },
      style: { border: { fg: "blue" }, fg: "white" },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: "█", style: { fg: "cyan" } },
      keys: true,
      vi: true,
      mouse: true,
    });

    const statusBar = blessed.box({
      bottom: 0, left: 0, width: "100%", height: 1,
      tags: true,
      content: `{grey-fg} ↑/↓:scroll feed{/grey-fg}`,
      style: { bg: "black" },
    });

    screen.append(header);
    screen.append(panelA);
    screen.append(panelB);
    screen.append(feedBox);
    screen.append(statusBar);

    screen.key(["up"], () => feedBox.scroll(-1));
    screen.key(["down"], () => feedBox.scroll(1));
    feedBox.focus();

    const log = (msg: string) => feedBox.log(msg);

    const updateHeader = (m: MatchPayload) => {
      const timeStr = formatTime(m.timeRemainingSeconds);
      const statusColor = m.status === "running" ? "green-fg" : m.status === "completed" ? "yellow-fg" : "red-fg";
      header.setContent(
        `{center}{bold}AGENT SLAM ARENA{/bold}  │  ${m.tokenPair}  │  {cyan-fg}$${m.ethPrice.toFixed(2)}{/}  │  {${statusColor}}⏱ ${timeStr}{/}  │  {${statusColor}}${m.status.toUpperCase()}{/}{/center}`,
      );
    };

    const updatePanel = (panel: blessed.Widgets.BoxElement, name: string, state: MatchPayload["contenders"]["A"], cap: number) => {
      const pnl = pnlStr(state.pnlPct);
      const portfolioBar = Math.round((state.portfolioUsd / cap) * 20);
      const barFill = "█".repeat(Math.min(portfolioBar, 30));
      const barEmpty = "░".repeat(Math.max(0, 30 - portfolioBar));
      panel.setContent(
        [
          `  {bold}${name}{/bold}`,
          ``,
          `  Portfolio:  {cyan-fg}$${state.portfolioUsd.toFixed(2)}{/}`,
          `  PnL:        ${pnl}`,
          `  Trades:     ${state.trades}`,
          `  Capital:    [$${cap}]`,
          `  ${barFill}${barEmpty}`,
        ].join("\n"),
      );
    };

    let matchEnded = false;
    let nextAction: "new_match" | "leaderboard" | "quit" = "quit";

    const showPostMatch = (m: MatchPayload) => {
      matchEnded = true;

      log("");
      log("{bold}════════════════════════════════════════{/}");
      log("{bold}  MATCH COMPLETED{/}");
      log("{bold}════════════════════════════════════════{/}");
      log(`  ${nameA}: ${pnlStr(m.contenders.A.pnlPct)} (${m.contenders.A.portfolioUsd.toFixed(2)})`);
      log(`  ${nameB}: ${pnlStr(m.contenders.B.pnlPct)} (${m.contenders.B.portfolioUsd.toFixed(2)})`);

      const pnlGap = Math.abs(m.contenders.A.pnlPct - m.contenders.B.pnlPct);
      const usdGap = Math.abs(m.contenders.A.portfolioUsd - m.contenders.B.portfolioUsd);
      if (pnlGap >= OUTCOME_RELATIVE_PNL_TOLERANCE_PCT) {
        if (m.contenders.A.pnlPct > m.contenders.B.pnlPct) log(`  {yellow-fg}Winner: ${nameA}{/}`);
        else log(`  {yellow-fg}Winner: ${nameB}{/}`);
      } else if (usdGap <= OUTCOME_PORTFOLIO_USD_EPS) {
        log(`  {yellow-fg}Result: DRAW{/}`);
      } else if (m.contenders.A.portfolioUsd > m.contenders.B.portfolioUsd) {
        log(`  {yellow-fg}Winner: ${nameA}{/}`);
      } else {
        log(`  {yellow-fg}Winner: ${nameB}{/}`);
      }
      log("{bold}════════════════════════════════════════{/}");
      log("");
      log("{grey-fg}n: new match  l: leaderboard  q: quit{/}");

      const postMenu = blessed.list({
        top: "center",
        left: "center",
        width: 36,
        height: 7,
        tags: true,
        label: " WHAT NEXT? ",
        border: { type: "line" },
        style: { border: { fg: "cyan" }, bg: "black", selected: { bg: "cyan", fg: "black" }, item: { fg: "white" } },
        keys: true,
        vi: true,
        mouse: true,
        items: ["New Match", "Leaderboard", "Quit"],
      });
      postMenu.select(0);
      screen.append(postMenu);
      postMenu.focus();
      screen.render();

      const onPostEnter = () => {
        cleanupKeys(screen, { enter: onPostEnter, escape: onPostEsc });
        const idx = (postMenu as unknown as { selected: number }).selected;
        postMenu.destroy();
        screen.render();
        if (idx === 0) nextAction = "new_match";
        else if (idx === 1) nextAction = "leaderboard";
        else nextAction = "quit";
        doCleanup();
        resolve(nextAction);
      };

      const onPostEsc = () => {
        cleanupKeys(screen, { enter: onPostEnter, escape: onPostEsc });
        postMenu.destroy();
        screen.render();
        doCleanup();
        resolve("quit");
      };

      screen.key("enter", onPostEnter);
      screen.key("escape", onPostEsc);
    };

    const doCleanup = () => {
      header.destroy();
      panelA.destroy();
      panelB.destroy();
      feedBox.destroy();
      statusBar.destroy();
      screen.render();
    };

    log("{grey-fg}Setting up match...{/}");
    screen.render();

    (async () => {
      try {
        const agentAResp = await api<{ id: string }>("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nameA, strategy: config.strategyA }),
        });

        const agentBResp = await api<{ id: string }>("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nameB, strategy: config.strategyB }),
        });

        log(`{green-fg}✓{/} Created agent A: ${nameA} (${agentAResp.id})`);
        log(`{green-fg}✓{/} Created agent B: ${nameB} (${agentBResp.id})`);

        const match = await api<MatchPayload>("/api/matches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentA: agentAResp.id,
            agentB: agentBResp.id,
            tokenPair: config.tokenPair,
            startingCapitalUsd: config.capital,
            durationSeconds: config.durationSeconds,
          }),
        });

        log(`{green-fg}✓{/} Match created: ${match.id}`);
        log(`{grey-fg}  ${nameA} vs ${nameB}  │  ${config.tokenPair}  │  $${config.capital}  │  ${config.durationSeconds}s{/}`);
        log("");

        updateHeader(match);
        updatePanel(panelA, nameA, match.contenders.A, capital);
        updatePanel(panelB, nameB, match.contenders.B, capital);
        screen.render();

        const ws = new WebSocket(`${wsUrl}/ws/matches/${match.id}`);

        ws.on("message", (raw: Buffer) => {
          if (matchEnded) return;
          let env: Envelope;
          try {
            env = JSON.parse(raw.toString()) as Envelope;
          } catch {
            log(`{red-fg}Received malformed WebSocket message{/}`);
            screen.render();
            return;
          }

          if (env.event === "snapshot") {
            const m = env.payload as MatchPayload;
            updateHeader(m);
            updatePanel(panelA, nameA, m.contenders.A, capital);
            updatePanel(panelB, nameB, m.contenders.B, capital);
          }

          if (env.event === "decision") {
            const d = env.payload as { contender: string; action: string; amount: number; reasoning: string; confidence: number };
            const actionColor = d.action === "buy" ? "green-fg" : d.action === "sell" ? "red-fg" : "grey-fg";
            const ts = new Date(env.timestamp);
            const time = `${ts.getMinutes().toString().padStart(2, "0")}:${ts.getSeconds().toString().padStart(2, "0")}`;
            log(`{grey-fg}[${time}]{/} {bold}${d.contender}{/}: {${actionColor}}${d.action.toUpperCase()}{/} $${d.amount.toFixed(0)} (confidence: ${(d.confidence * 100).toFixed(0)}%)`);
            log(`  {grey-fg}${d.reasoning}{/}`);
          }

          if (env.event === "trade_executed") {
            const t = env.payload as TradePayload;
            log(`  {cyan-fg}TRADE{/} ${t.contender}: ${t.sold.amount.toFixed(2)} ${t.sold.token} → ${t.bought.amount.toFixed(6)} ${t.bought.token} (gas: $${t.gasUsd})`);
            if (t.executionMode === "uniswap_live_swap" || t.keeperhubSubmissionId || t.keeperhubStatus || t.lastExecutionError) {
              const status = t.keeperhubStatus ?? (t.keeperhubSubmissionId ? "submitted" : "not-submitted");
              const statusColor = keeperHubStatusColor(t.keeperhubStatus, t.lastExecutionError);
              const retries = t.keeperhubRetryCount !== undefined ? ` retries=${t.keeperhubRetryCount}` : "";
              log(`  {${statusColor}}KeeperHub ${status.toUpperCase()}{/}${t.keeperhubSubmissionId ? ` id=${t.keeperhubSubmissionId}` : ""}${retries}`);
              if (t.onChainTxHash) log(`  {green-fg}Onchain{/} ${t.onChainTxHash}`);
              if (t.keeperhubTransactionLink) log(`  {blue-fg}${t.keeperhubTransactionLink}{/}`);
              if (t.lastExecutionError) log(`  {red-fg}${t.lastExecutionError}{/}`);
            }
          }

          if (env.event === "completed") {
            const m = env.payload as MatchPayload;
            showPostMatch(m);
          }

          if (env.event === "stopped") {
            log("{red-fg}Match stopped by user.{/}");
            if (!matchEnded) {
              matchEnded = true;
              doCleanup();
              resolve("quit");
            }
          }

          screen.render();
        });

        ws.on("error", (err) => {
          log(`{red-fg}WebSocket error: ${err.message}{/}`);
          screen.render();
        });

        ws.on("close", () => {
          log("{grey-fg}WebSocket closed.{/}");
          screen.render();
        });
      } catch (err) {
        log(`{red-fg}Error: ${(err as Error).message}{/}`);
        screen.render();
        if (!matchEnded) {
          matchEnded = true;
          doCleanup();
          resolve("quit");
        }
      }
    })();
  });
}

async function main() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Agent Slam Arena",
    fullUnicode: true,
  });

  screen.key(["q", "C-c"], () => {
    process.exit(0);
  });

  let strategies: StrategyOption[] = [];
  try {
    strategies = await api<StrategyOption[]>("/api/strategies");
  } catch {
    for (const [id, name] of Object.entries(STRATEGY_NAMES)) {
      strategies.push({ id, name, riskProfile: "", description: "" });
    }
  }

  let phase: ScreenPhase = "menu";
  let currentConfig: MatchConfig = {
    strategyA: STRATEGY_A,
    strategyB: STRATEGY_B,
    tokenPair: TOKEN_PAIR,
    capital: CAPITAL,
    durationSeconds: DURATION,
  };

  while (true) {
    if (phase === "menu") {
      const action = await showMainMenu(screen);
      if (action === "quit") break;
      if (action === "leaderboard") {
        phase = "leaderboard";
        continue;
      }
      phase = "strategies";
      continue;
    }

    if (phase === "leaderboard") {
      await showLeaderboard(screen);
      phase = "menu";
      continue;
    }

    if (phase === "strategies") {
      const selected = await selectStrategies(screen, strategies);
      if (!selected.strategyA) {
        phase = "menu";
        continue;
      }
      currentConfig.strategyA = selected.strategyA;
      currentConfig.strategyB = selected.strategyB;
      phase = "config";
      continue;
    }

    if (phase === "config") {
      const config = await configureMatch(screen, currentConfig);
      if (!config) {
        phase = "strategies";
        continue;
      }
      currentConfig = config;
      phase = "review";
      continue;
    }

    if (phase === "review") {
      const confirmed = await showReview(screen, currentConfig);
      if (!confirmed) {
        phase = "config";
        continue;
      }
      phase = "live";
      continue;
    }

    if (phase === "live") {
      const result = await runLiveMatch(screen, currentConfig);
      if (result === "quit") break;
      if (result === "leaderboard") {
        phase = "leaderboard";
        continue;
      }
      phase = "strategies";
      continue;
    }

    break;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("TUI failed:", err);
  process.exit(1);
});
