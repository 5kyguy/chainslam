import blessed from "blessed";
import WebSocket from "ws";

const BASE_URL = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ?? "http://127.0.0.1:8787";
const STRATEGY_A = process.argv.find((a) => a.startsWith("--strategy-a="))?.split("=")[1] ?? "momentum";
const STRATEGY_B = process.argv.find((a) => a.startsWith("--strategy-b="))?.split("=")[1] ?? "mean_reverter";
const DURATION = parseInt(process.argv.find((a) => a.startsWith("--duration="))?.split("=")[1] ?? "300", 10);
const CAPITAL = parseInt(process.argv.find((a) => a.startsWith("--capital="))?.split("=")[1] ?? "1000", 10);
const TOKEN_PAIR = process.argv.find((a) => a.startsWith("--pair="))?.split("=")[1] ?? "WETH/USDC";

const STRATEGY_NAMES: Record<string, string> = {
  dca: "DCA Bot",
  momentum: "Momentum Trader",
  mean_reverter: "Mean Reverter",
  fear_greed: "Fear & Greed",
  grid: "Grid Trader",
  random: "Random Walk",
};

const wsUrl = BASE_URL.replace(/^http/, "ws");

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
    A: { name: string; pnlPct: number; portfolioUsd: number; trades: number };
    B: { name: string; pnlPct: number; portfolioUsd: number; trades: number };
  };
}

interface Envelope {
  event: string;
  match_id: string;
  timestamp: string;
  payload: unknown;
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

async function main() {
  const nameA = STRATEGY_NAMES[STRATEGY_A] ?? STRATEGY_A;
  const nameB = STRATEGY_NAMES[STRATEGY_B] ?? STRATEGY_B;

  const screen = blessed.screen({
    smartCSR: true,
    title: "Agent Slam Arena",
    fullUnicode: true,
  });

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
    label: ` CONTENDER A `,
    border: { type: "line" },
    style: { border: { fg: "yellow" }, fg: "white" },
    content: `  {bold}${nameA}{/bold}\n  Waiting for match...`,
  });

  const panelB = blessed.box({
    top: 3, left: "50%", width: "50%", height: 11,
    tags: true,
    label: ` CONTENDER B `,
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
    content: `{grey-fg} q:quit  ↑/↓:scroll feed{/grey-fg}`,
    style: { bg: "black" },
  });

  screen.append(header);
  screen.append(panelA);
  screen.append(panelB);
  screen.append(feedBox);
  screen.append(statusBar);

  screen.key(["q", "C-c"], () => process.exit(0));
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

  const updatePanel = (panel: blessed.Widgets.BoxElement, name: string, state: MatchPayload["contenders"]["A"], capital: number) => {
    const pnl = pnlStr(state.pnlPct);
    const portfolioBar = Math.round((state.portfolioUsd / capital) * 20);
    const barFill = "█".repeat(Math.min(portfolioBar, 30));
    const barEmpty = "░".repeat(Math.max(0, 30 - portfolioBar));
    panel.setContent(
      [
        `  {bold}${name}{/bold}`,
        ``,
        `  Portfolio:  {cyan-fg}$${state.portfolioUsd.toFixed(2)}{/}`,
        `  PnL:        ${pnl}`,
        `  Trades:     ${state.trades}`,
        `  Capital:    [$${capital}]`,
        `  ${barFill}${barEmpty}`,
      ].join("\n"),
    );
  };

  log("{grey-fg}Setting up match...{/}");

  screen.render();

  try {
    const agentAResp = await api<{ id: string }>("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameA, strategy: STRATEGY_A }),
    });

    const agentBResp = await api<{ id: string }>("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameB, strategy: STRATEGY_B }),
    });

    log(`{green-fg}✓{/} Created agent A: ${nameA} (${agentAResp.id})`);
    log(`{green-fg}✓{/} Created agent B: ${nameB} (${agentBResp.id})`);

    const match = await api<MatchPayload>("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentA: agentAResp.id,
        agentB: agentBResp.id,
        tokenPair: TOKEN_PAIR,
        startingCapitalUsd: CAPITAL,
        durationSeconds: DURATION,
      }),
    });

    log(`{green-fg}✓{/} Match created: ${match.id}`);
    log(`{grey-fg}  ${nameA} vs ${nameB}  │  ${TOKEN_PAIR}  │  $${CAPITAL}  │  ${DURATION}s{/}`);
    log("");

    updateHeader(match);
    updatePanel(panelA, nameA, match.contenders.A, CAPITAL);
    updatePanel(panelB, nameB, match.contenders.B, CAPITAL);
    screen.render();

    const ws = new WebSocket(`${wsUrl}/ws/matches/${match.id}`);

    ws.on("message", (raw: Buffer) => {
      const env = JSON.parse(raw.toString()) as Envelope;

      if (env.event === "snapshot") {
        const m = env.payload as MatchPayload;
        updateHeader(m);
        updatePanel(panelA, nameA, m.contenders.A, CAPITAL);
        updatePanel(panelB, nameB, m.contenders.B, CAPITAL);
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
        const t = env.payload as { contender: string; sold: { token: string; amount: number }; bought: { token: string; amount: number }; gasUsd: number };
        log(`  {cyan-fg}TRADE{/} ${t.contender}: ${t.sold.amount.toFixed(2)} ${t.sold.token} → ${t.bought.amount.toFixed(6)} ${t.bought.token} (gas: $${t.gasUsd})`);
      }

      if (env.event === "completed") {
        const m = env.payload as MatchPayload;
        log("");
        log("{bold}════════════════════════════════════════{/}");
        log("{bold}  MATCH COMPLETED{/}");
        log("{bold}════════════════════════════════════════{/}");
        log(`  ${nameA}: ${pnlStr(m.contenders.A.pnlPct)} (${m.contenders.A.portfolioUsd.toFixed(2)})`);
        log(`  ${nameB}: ${pnlStr(m.contenders.B.pnlPct)} (${m.contenders.B.portfolioUsd.toFixed(2)})`);

        const diff = Math.abs(m.contenders.A.pnlPct - m.contenders.B.pnlPct);
        if (diff < 0.25) {
          log(`  {yellow-fg}Result: DRAW{/}`);
        } else if (m.contenders.A.pnlPct > m.contenders.B.pnlPct) {
          log(`  {yellow-fg}Winner: ${nameA}{/}`);
        } else {
          log(`  {yellow-fg}Winner: ${nameB}{/}`);
        }
        log("{bold}════════════════════════════════════════{/}");
        log("");
        log("{grey-fg}Press q to exit{/}");
        feedBox.focus();
      }

      if (env.event === "stopped") {
        log("{red-fg}Match stopped by user.{/}");
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
    setTimeout(() => process.exit(1), 3000);
  }
}

main().catch((err) => {
  console.error("TUI failed:", err);
  process.exit(1);
});
