import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { getConfig } from "../src/config.js";
import { registerHttpRoutes } from "../src/routes/http-routes.js";
import { registerAgentRoutes } from "../src/routes/agent-routes.js";
import { registerWsRoutes } from "../src/routes/ws-routes.js";
import { createMatchService } from "../src/services/service-factory.js";
import { AgentService } from "../src/services/agent-service.js";
import { InMemoryStore } from "../src/store/in-memory-store.js";
import type { AgentProcessManager, ManagedAgent } from "../src/agents/process-manager.js";
import type { StrategySignal, TickContext } from "../src/types.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  process.env.UNISWAP_API_KEY = process.env.UNISWAP_API_KEY || "smoke-test-key";
  const config = getConfig();
  const app = Fastify({ logger: false });

  const store = new InMemoryStore();
  await store.init();

  const agentService = new AgentService(config, store);

  const holdSignal: StrategySignal = {
    action: "hold",
    amount: 0,
    reasoning: "Smoke test stub agent.",
    confidence: 0,
  };

  const managedById = new Map<string, ManagedAgent>();
  const stubProcessManager = {
    spawn(agentId: string) {
      const managed = {
        agentId,
        process: { kill() {}, on() {}, stdout: null, stderr: null } as unknown as ManagedAgent["process"],
        connection: {
          evaluate: async (_ctx: TickContext) => holdSignal,
          sendEnd() {},
        },
      } as unknown as ManagedAgent;
      managedById.set(agentId, managed);
      return managed;
    },
    kill(agentId: string) {
      managedById.delete(agentId);
    },
    get(agentId: string) {
      return managedById.get(agentId);
    },
    killAll() {
      managedById.clear();
    },
  } as unknown as AgentProcessManager;

  app.decorate("matchService", createMatchService(config, agentService, store, stubProcessManager));
  app.decorate("agentService", agentService);
  await app.register(cors, { origin: "*" });
  await app.register(websocket);

  await registerAgentRoutes(app);
  await registerHttpRoutes(app);
  await registerWsRoutes(app);

  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const base = new URL(address);
  const httpBase = `${base.protocol}//${base.host}`;
  const wsBase = `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}`;

  const strategies = await fetch(`${httpBase}/api/strategies`).then((r) => r.json());
  if (!Array.isArray(strategies) || strategies.length < 2) {
    throw new Error("Expected at least two strategies");
  }

  const agentA = await fetch(`${httpBase}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: strategies[0].name, strategy: strategies[0].id }),
  }).then((r) => r.json());

  const agentB = await fetch(`${httpBase}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: strategies[1].name, strategy: strategies[1].id }),
  }).then((r) => r.json());

  if (!agentA?.id || !agentB?.id) {
    throw new Error("Agent creation failed");
  }

  const created = await fetch(`${httpBase}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentA: agentA.id,
      agentB: agentB.id,
      tokenPair: "WETH/USDC",
      startingCapitalUsd: 1000,
      durationSeconds: 60,
    }),
  }).then((r) => r.json());

  if (!created?.id) {
    throw new Error("Match creation did not return id");
  }

  const wsEvents: string[] = [];
  const ws = new WebSocket(`${wsBase}/ws/matches/${created.id}`);
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    wsEvents.push(payload.event);
  });

  await sleep(500);

  const memoryJson = await fetch(`${httpBase}/api/matches/${created.id}/memory`).then((r) => r.json());
  if (!Array.isArray(memoryJson?.events) || memoryJson.events.length < 1) {
    throw new Error("Memory API returned no events (expected match_started; set ZEROG_ENABLED=false to disable memory)");
  }
  const startEv = memoryJson.events[0];
  if (startEv?.kind !== "match_started" || startEv?.schemaVersion !== 1) {
    throw new Error("Memory timeline missing versioned match_started event");
  }

  const zgProbe = await fetch(`${httpBase}/api/matches/${created.id}/memory/zg`).then((r) => r.json());
  if (typeof zgProbe?.configured !== "boolean") {
    throw new Error("Memory /zg response missing configured flag");
  }

  const match = await fetch(`${httpBase}/api/matches/${created.id}`).then((r) => r.json());
  const feed = await fetch(`${httpBase}/api/matches/${created.id}/feed`).then((r) => r.json());
  const trades = await fetch(`${httpBase}/api/matches/${created.id}/trades`).then((r) => r.json());
  await fetch(`${httpBase}/api/matches/${created.id}/stop`, { method: "POST" }).then((r) => r.json());
  const leaderboard = await fetch(`${httpBase}/api/leaderboard`).then((r) => r.json());

  if (!match?.id || !Array.isArray(feed) || !Array.isArray(trades) || !Array.isArray(leaderboard)) {
    throw new Error("One or more contract endpoints failed");
  }
  if (!wsEvents.includes("snapshot")) {
    throw new Error("WS stream did not emit snapshot");
  }

  ws.close();
  await app.close();
  console.log("Smoke test passed");
}

run().catch((error) => {
  console.error("Smoke test failed", error);
  process.exit(1);
});
