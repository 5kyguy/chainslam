type StrategyOption = {
  id: string;
  name: string;
};

type AgentResponse = {
  id: string;
  name: string;
  strategy: string;
};

type ContenderSnapshot = {
  name?: string;
  pnlPct?: number;
  portfolioUsd?: number;
  trades?: number;
};

type MatchResponse = {
  id: string;
  status: string;
  tokenPair?: string;
  durationSeconds?: number;
  startingCapitalUsd?: number;
  timeRemainingSeconds?: number;
  ethPrice?: number;
  contenders?: {
    A?: ContenderSnapshot;
    B?: ContenderSnapshot;
  };
};

type WsEnvelope = {
  event: "snapshot" | "decision" | "trade_executed" | "completed" | "stopped";
  match_id: string;
  timestamp: string;
  payload: unknown;
};

type DecisionPayload = {
  contender: string;
  action: "buy" | "sell" | "hold";
  amount: number;
  confidence: number;
  reasoning?: string;
};

type TradePayload = {
  contender: string;
  txHash: string;
  sold?: { token: string; amount: number };
  bought?: { token: string; amount: number };
  gasUsd?: number;
};

type AgentLiveStats = {
  name: string;
  strategy: string;
  decisions: number;
  buys: number;
  sells: number;
  holds: number;
  decisionAmountTotal: number;
  confidenceTotal: number;
  confidenceCount: number;
  trades: number;
  gasUsdTotal: number;
  latestPnlPct?: number;
  latestPortfolioUsd?: number;
  latestSnapshotTrades?: number;
};

type LiveState = {
  startedAtMs: number;
  eventCounts: Record<WsEnvelope["event"], number>;
  lastEventLabel?: string;
  agents: Record<string, AgentLiveStats>;
};

type CliOptions = {
  baseUrl: string;
  durationSeconds: number;
  tokenPair: string;
  startingCapitalUsd: number;
  silent: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let baseUrl = process.env.MATCH_SIM_BASE_URL ?? "http://127.0.0.1:8787";
  let durationSeconds = 45;
  let tokenPair = "WETH/USDC";
  let startingCapitalUsd = 1000;
  let silent = false;

  for (const arg of argv) {
    if (arg === "--silent") {
      silent = true;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (arg.startsWith("--duration=")) {
      durationSeconds = Number(arg.slice("--duration=".length));
      continue;
    }
    if (arg.startsWith("--token-pair=")) {
      tokenPair = arg.slice("--token-pair=".length);
      continue;
    }
    if (arg.startsWith("--starting-capital=")) {
      startingCapitalUsd = Number(arg.slice("--starting-capital=".length));
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 30) {
    throw new Error("Invalid --duration. Use a number >= 30.");
  }
  if (!Number.isFinite(startingCapitalUsd) || startingCapitalUsd < 10) {
    throw new Error("Invalid --starting-capital. Use a number >= 10.");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    durationSeconds,
    tokenPair,
    startingCapitalUsd,
    silent,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText} at ${url}\n${text}`);
  }
  return data as T;
}

function section(title: string): void {
  console.log(`\n========== ${title} ==========`);
}

function toWsUrl(httpBase: string, matchId: string): string {
  const u = new URL(httpBase);
  const protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${u.host}/ws/matches/${matchId}`;
}

function formatNum(value: number | undefined, fractionDigits = 2): string {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(fractionDigits);
}

function ensureAgent(state: LiveState, name: string): AgentLiveStats {
  const key = name || "unknown";
  if (!state.agents[key]) {
    state.agents[key] = {
      name: key,
      strategy: "-",
      decisions: 0,
      buys: 0,
      sells: 0,
      holds: 0,
      decisionAmountTotal: 0,
      confidenceTotal: 0,
      confidenceCount: 0,
      trades: 0,
      gasUsdTotal: 0,
    };
  }
  return state.agents[key];
}

function renderLiveAgentTable(state: LiveState, timeRemainingSeconds?: number): void {
  const elapsed = ((Date.now() - state.startedAtMs) / 1000).toFixed(1);
  console.clear();
  section(`LIVE MATCH METRICS | elapsed=${elapsed}s | remaining=${timeRemainingSeconds ?? "-"}s`);
  if (state.lastEventLabel) {
    console.log(`Last event: ${state.lastEventLabel}`);
  }
  console.log(
    `Events => snapshot=${state.eventCounts.snapshot}, decision=${state.eventCounts.decision}, trade=${state.eventCounts.trade_executed}, completed=${state.eventCounts.completed}, stopped=${state.eventCounts.stopped}`
  );

  const rows = Object.values(state.agents).map((agent) => {
    const avgConfidence = agent.confidenceCount > 0 ? agent.confidenceTotal / agent.confidenceCount : undefined;
    return {
      agent: agent.name,
      strategy: agent.strategy,
      pnlPct: formatNum(agent.latestPnlPct, 2),
      portfolioUsd: formatNum(agent.latestPortfolioUsd, 2),
      decisions: agent.decisions,
      "buy/sell/hold": `${agent.buys}/${agent.sells}/${agent.holds}`,
      decisionVolume: formatNum(agent.decisionAmountTotal, 2),
      avgConfidence: formatNum(avgConfidence, 3),
      tradesWs: agent.trades,
      tradesSnapshot: agent.latestSnapshotTrades ?? "-",
      gasUsd: formatNum(agent.gasUsdTotal, 2),
    };
  });
  if (rows.length > 0) {
    console.table(rows);
  }
}

function applyDecision(state: LiveState, payload: DecisionPayload): void {
  const agent = ensureAgent(state, payload.contender);
  agent.decisions += 1;
  agent.decisionAmountTotal += Number.isFinite(payload.amount) ? payload.amount : 0;
  if (Number.isFinite(payload.confidence)) {
    agent.confidenceTotal += payload.confidence;
    agent.confidenceCount += 1;
  }

  if (payload.action === "buy") {
    agent.buys += 1;
  } else if (payload.action === "sell") {
    agent.sells += 1;
  } else {
    agent.holds += 1;
  }
}

function applyTrade(state: LiveState, payload: TradePayload): void {
  const agent = ensureAgent(state, payload.contender);
  agent.trades += 1;
  if (Number.isFinite(payload.gasUsd)) {
    agent.gasUsdTotal += payload.gasUsd as number;
  }
}

function applySnapshot(state: LiveState, payload: MatchResponse): void {
  const contenderA = payload.contenders?.A;
  const contenderB = payload.contenders?.B;
  if (contenderA?.name) {
    const agent = ensureAgent(state, contenderA.name);
    agent.latestPnlPct = contenderA.pnlPct;
    agent.latestPortfolioUsd = contenderA.portfolioUsd;
    agent.latestSnapshotTrades = contenderA.trades;
  }
  if (contenderB?.name) {
    const agent = ensureAgent(state, contenderB.name);
    agent.latestPnlPct = contenderB.pnlPct;
    agent.latestPortfolioUsd = contenderB.portfolioUsd;
    agent.latestSnapshotTrades = contenderB.trades;
  }
}

function printEventBanner(event: WsEnvelope): void {
  const at = new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false });
  // Kept as a compact value for the in-place dashboard render.
  // Avoids flooding the terminal with repeated multi-line event logs.
  // Format example: [12:00:01] DECISION | match_123
  // This value is displayed inside renderLiveAgentTable.
  // It is not printed directly for every event.
  void at;
  void event;
}

async function waitForTerminalEvent(
  wsUrl: string,
  matchId: string,
  state: LiveState
): Promise<{ events: WsEnvelope[]; lastSnapshot?: MatchResponse }> {
  return new Promise<{ events: WsEnvelope[]; lastSnapshot?: MatchResponse }>((resolve, reject) => {
    const events: WsEnvelope[] = [];
    let lastSnapshot: MatchResponse | undefined;
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for match completion (${matchId}).`));
    }, 10 * 60 * 1000);

    ws.addEventListener("open", () => {
      console.log(`\nSubscribed: ${wsUrl}`);
    });

    ws.addEventListener("message", (event) => {
      let parsed: WsEnvelope;
      try {
        parsed = JSON.parse(String(event.data)) as WsEnvelope;
      } catch (error) {
        console.error("WS message parse error", error);
        return;
      }
      events.push(parsed);
      state.eventCounts[parsed.event] += 1;
      const at = new Date(parsed.timestamp).toLocaleTimeString("en-US", { hour12: false });
      state.lastEventLabel = `[${at}] ${parsed.event.toUpperCase()} | ${parsed.match_id}`;

      if (parsed.event === "decision") {
        const payload = parsed.payload as DecisionPayload;
        applyDecision(state, payload);
        state.lastEventLabel = `${state.lastEventLabel} | ${payload.contender} ${payload.action.toUpperCase()} ${formatNum(payload.amount, 2)} conf=${formatNum(payload.confidence, 3)}`;
      } else if (parsed.event === "trade_executed") {
        const payload = parsed.payload as TradePayload;
        applyTrade(state, payload);
        const sold = payload.sold ? `${formatNum(payload.sold.amount, 4)} ${payload.sold.token}` : "-";
        const bought = payload.bought ? `${formatNum(payload.bought.amount, 4)} ${payload.bought.token}` : "-";
        state.lastEventLabel = `${state.lastEventLabel} | ${payload.contender} sold ${sold} -> ${bought}`;
      } else if (parsed.event === "snapshot") {
        const payload = parsed.payload as MatchResponse;
        lastSnapshot = payload;
        applySnapshot(state, payload);
      }

      if (parsed.event === "decision" || parsed.event === "trade_executed" || parsed.event === "snapshot") {
        const snapshotPayload = parsed.event === "snapshot" ? (parsed.payload as MatchResponse) : undefined;
        renderLiveAgentTable(state, snapshotPayload?.timeRemainingSeconds ?? lastSnapshot?.timeRemainingSeconds);
      }

      if (parsed.event === "completed" || parsed.event === "stopped") {
        clearTimeout(timeout);
        ws.close();
        resolve({ events, lastSnapshot });
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error while subscribed to match ${matchId}.`));
    });
  });
}

function summarizeMatchResult(match: MatchResponse, wsEvents: WsEnvelope[], feedCount: number, tradeCount: number): void {
  const contenderA = match.contenders?.A;
  const contenderB = match.contenders?.B;
  const pnlSpread =
    contenderA?.pnlPct !== undefined && contenderB?.pnlPct !== undefined
      ? Math.abs(contenderA.pnlPct - contenderB.pnlPct)
      : undefined;
  const winner =
    contenderA?.pnlPct === undefined || contenderB?.pnlPct === undefined
      ? "unknown"
      : contenderA.pnlPct === contenderB.pnlPct
        ? "draw"
        : contenderA.pnlPct > contenderB.pnlPct
          ? contenderA.name ?? "A"
          : contenderB.name ?? "B";

  section("MATCH RESULT");
  console.log(`Match ID: ${match.id}`);
  console.log(`Status: ${match.status}`);
  console.log(`Winner: ${winner}`);
  console.log(`PnL spread: ${pnlSpread !== undefined ? `${formatNum(pnlSpread, 2)}%` : "n/a"}`);
  console.log(`Feed events (REST): ${feedCount}`);
  console.log(`Trades (REST): ${tradeCount}`);
  console.log(`WS messages: ${wsEvents.length}`);

}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  const strategies = await requestJson<StrategyOption[]>(`${options.baseUrl}/api/strategies`);
  if (!Array.isArray(strategies) || strategies.length < 2) {
    throw new Error("Need at least two strategies from /api/strategies.");
  }

  const agentA = await requestJson<AgentResponse>(`${options.baseUrl}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${strategies[0].name} (sim A)`,
      strategy: strategies[0].id,
    }),
  });

  const agentB = await requestJson<AgentResponse>(`${options.baseUrl}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${strategies[1].name} (sim B)`,
      strategy: strategies[1].id,
    }),
  });

  const createdMatch = await requestJson<MatchResponse>(`${options.baseUrl}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentA: agentA.id,
      agentB: agentB.id,
      tokenPair: options.tokenPair,
      startingCapitalUsd: options.startingCapitalUsd,
      durationSeconds: options.durationSeconds,
    }),
  });
  section("MATCH SETUP");
  console.table([
    { role: "Agent A", name: agentA.name, id: agentA.id, strategy: agentA.strategy },
    { role: "Agent B", name: agentB.name, id: agentB.id, strategy: agentB.strategy },
  ]);
  console.table([
    {
      matchId: createdMatch.id,
      tokenPair: options.tokenPair,
      durationSeconds: options.durationSeconds,
      startingCapitalUsd: options.startingCapitalUsd,
      baseUrl: options.baseUrl,
    },
  ]);

  if (!createdMatch.id) {
    throw new Error("Match creation did not return a valid id.");
  }

  if (options.silent) {
    console.log("\nSilent mode enabled; skipping websocket subscription and final polling.");
    return;
  }

  const wsUrl = toWsUrl(options.baseUrl, createdMatch.id);
  const liveState: LiveState = {
    startedAtMs: Date.now(),
    eventCounts: {
      snapshot: 0,
      decision: 0,
      trade_executed: 0,
      completed: 0,
      stopped: 0,
    },
    agents: {
      [agentA.name]: {
        name: agentA.name,
        strategy: agentA.strategy,
        decisions: 0,
        buys: 0,
        sells: 0,
        holds: 0,
        decisionAmountTotal: 0,
        confidenceTotal: 0,
        confidenceCount: 0,
        trades: 0,
        gasUsdTotal: 0,
      },
      [agentB.name]: {
        name: agentB.name,
        strategy: agentB.strategy,
        decisions: 0,
        buys: 0,
        sells: 0,
        holds: 0,
        decisionAmountTotal: 0,
        confidenceTotal: 0,
        confidenceCount: 0,
        trades: 0,
        gasUsdTotal: 0,
      },
    },
  };

  const { events: wsEvents, lastSnapshot } = await waitForTerminalEvent(wsUrl, createdMatch.id, liveState);
  const match = await requestJson<MatchResponse>(`${options.baseUrl}/api/matches/${createdMatch.id}`);
  const feed = await requestJson<unknown[]>(`${options.baseUrl}/api/matches/${createdMatch.id}/feed`);
  const trades = await requestJson<unknown[]>(`${options.baseUrl}/api/matches/${createdMatch.id}/trades`);

  if (lastSnapshot) {
    applySnapshot(liveState, lastSnapshot);
  }
  summarizeMatchResult(match, wsEvents, feed.length, trades.length);
}

run().catch((error) => {
  console.error("\nMatch simulation failed");
  console.error(error);
  process.exit(1);
});
