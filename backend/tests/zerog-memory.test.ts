import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "../src/config.js";
import { ZeroGMemoryService } from "../src/services/zerog-memory-service.js";
import type { DecisionEvent } from "../src/types.js";
import type { ZeroGKvClient } from "../src/integrations/zerog.js";

function minimalConfig(): AppConfig {
  return {
    port: 8787,
    host: "0.0.0.0",
    corsOrigin: "*",
    databaseUrl: "",
    llm: { provider: "", apiKey: "", model: "", baseUrl: "" },
    uniswap: {
      apiKey: "",
      baseUrl: "",
      chainId: 1,
      swapperAddress: "",
      timeoutMs: 0,
      maxRetries: 0,
      swapMode: "mock",
      permit2Disabled: false,
      universalRouterVersion: "2.0",
      permitSignature: "",
    },
    agents: { pythonPath: "", packageDir: "" },
    keeperhub: {
      apiKey: "",
      baseUrl: "",
      timeoutMs: 0,
      maxRetries: 0,
      pollIntervalMs: 0,
      maxPollAttempts: 0,
    },
    trading: {
      minTradeUsd: 0.1,
      maxTradeUsdAbsolute: Number.POSITIVE_INFINITY,
      defaultPerAgentStartingCapitalUsd: 1000,
    },
    wallet: {
      privateKey: "",
    },
    zerog: {
      enabled: true,
      evmRpc: "",
      indexerRpc: "",
      kvRpc: "",
      privateKey: "",
      streamId: "",
      keyPrefix: "agentslam/test",
      maxRetries: 3,
      // Keep low so the test runner does not wait on open debounce timers.
      flushDebounceMs: 10,
      writeCooldownMs: 1_000,
    },
  };
}

function decision(_agentId: string): DecisionEvent {
  return {
    event: "decision",
    contender: "Agent",
    action: "hold",
    amount: 0,
    reasoning: "test",
    confidence: 0.5,
    timestamp: new Date().toISOString(),
  };
}

test("ZeroGMemoryService — pagination across match timeline", () => {
  const svc = new ZeroGMemoryService(minimalConfig());
  const matchId = "match_test_1";
  svc.recordMatchStarted({
    matchId,
    tokenPair: "WETH/USDC",
    startingCapitalUsd: 1000,
    durationSeconds: 60,
    contenderA: { agentId: "a1", name: "A", strategy: "dca" },
    contenderB: { agentId: "b1", name: "B", strategy: "momentum" },
  });
  for (let i = 0; i < 5; i++) {
    svc.recordDecision({
      matchId,
      agentId: "a1",
      contenderName: "A",
      tickNumber: i + 1,
      decision: decision("a1"),
    });
  }

  const p1 = svc.getMatchMemoryPage(matchId, { limit: 2, cursor: 0 });
  assert.equal(p1.events.length, 2);
  assert.equal(p1.events[0]?.kind, "match_started");
  assert.equal(p1.nextCursor, 2);

  const p2 = svc.getMatchMemoryPage(matchId, { limit: 10, cursor: 2 });
  // After page1 (match_started + first decision), four decisions remain.
  assert.equal(p2.events.length, 4);
  assert.equal(p2.events.every((e) => e.kind === "decision"), true);
  assert.equal(
    p2.events.map((e) => (e.payload as { tickNumber?: number }).tickNumber).join(","),
    "2,3,4,5",
  );
  assert.equal(p2.nextCursor, null);
});

test("ZeroGMemoryService — agent page only includes agent-scoped events", () => {
  const svc = new ZeroGMemoryService(minimalConfig());
  const matchId = "match_test_2";
  svc.recordMatchStarted({
    matchId,
    tokenPair: "WETH/USDC",
    startingCapitalUsd: 500,
    durationSeconds: 30,
    contenderA: { agentId: "ax", name: "Ax", strategy: "dca" },
    contenderB: { agentId: "bx", name: "Bx", strategy: "grid" },
  });
  svc.recordDecision({
    matchId,
    agentId: "ax",
    contenderName: "Ax",
    tickNumber: 1,
    decision: decision("ax"),
  });

  const agentPage = svc.getAgentMemoryPage("ax");
  assert.equal(agentPage.events.length, 1);
  assert.equal(agentPage.events[0]?.kind, "decision");
  assert.equal(agentPage.events[0]?.agentId, "ax");
});

test("ZeroGMemoryService — flushes only on action events (not hold decisions)", async () => {
  let putCount = 0;
  const kv = {
    isConfigured: () => true,
    putText: async () => {
      putCount += 1;
      return { txHash: `0x${putCount.toString(16)}`, rootHash: "0xroot" };
    },
    getText: async () => null,
  } as unknown as ZeroGKvClient;

  const svc = new ZeroGMemoryService(minimalConfig(), kv);
  const matchId = "match_action_flush";

  svc.recordMatchStarted({
    matchId,
    tokenPair: "WETH/USDC",
    startingCapitalUsd: 1000,
    durationSeconds: 60,
    contenderA: { agentId: "a1", name: "A", strategy: "dca" },
    contenderB: { agentId: "b1", name: "B", strategy: "momentum" },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(putCount, 1, "match_started flushes match snapshot");

  svc.recordDecision({
    matchId,
    agentId: "a1",
    contenderName: "A",
    tickNumber: 1,
    decision: {
      event: "decision",
      contender: "A",
      action: "hold",
      amount: 0,
      reasoning: "noop",
      confidence: 0.5,
      timestamp: new Date().toISOString(),
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(putCount, 1, "hold decision does not flush");

  svc.recordDecision({
    matchId,
    agentId: "a1",
    contenderName: "A",
    tickNumber: 2,
    decision: {
      event: "decision",
      contender: "A",
      action: "buy",
      amount: 0.1,
      reasoning: "action",
      confidence: 0.8,
      timestamp: new Date().toISOString(),
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(putCount, 3, "non-hold decision flushes match + agent snapshot");
});
