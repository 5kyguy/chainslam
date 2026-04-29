import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, type Abi } from "viem";
import {
  chainIdToKeeperHubNetwork,
  decodeUniversalRouterExecuteCalldata,
  KeeperHubClient,
  normalizeKeeperHubStatus,
} from "../src/integrations/keeperhub.js";
import { KeeperHubExecutionPoller } from "../src/services/keeperhub-execution-poller.js";
import { InMemoryStore } from "../src/store/in-memory-store.js";
import type { AppConfig } from "../src/config.js";
import type { KeeperHubExecutionStatus } from "../src/integrations/keeperhub.js";
import type { TradeEvent } from "../src/types.js";

const EXECUTE_ABI: Abi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
];

function encodedUniversalRouterCall(): string {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: ["0x0b00", ["0x1234", "0xabcd"], 123n],
  });
}

function trade(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    event: "trade_executed",
    contender: "Momentum Trader",
    txHash: "0xplaceholder",
    sold: { token: "USDC", amount: 1 },
    bought: { token: "WETH", amount: 0.0003 },
    gasUsd: 0.01,
    timestamp: new Date(0).toISOString(),
    tradeRecordId: "trade_1",
    executionMode: "uniswap_live_swap",
    ...overrides,
  };
}

function pollerConfig(overrides: Partial<AppConfig["keeperhub"]> = {}): AppConfig["keeperhub"] {
  return {
    apiKey: "kh_test",
    baseUrl: "https://keeperhub.test/api",
    timeoutMs: 1000,
    maxRetries: 1,
    pollIntervalMs: 1000,
    maxPollAttempts: 3,
    ...overrides,
  };
}

test("KeeperHub calldata helpers decode Universal Router execute calldata", () => {
  const decoded = decodeUniversalRouterExecuteCalldata(encodedUniversalRouterCall());
  assert.ok(decoded);
  assert.equal(decoded.functionName, "execute");
  assert.equal(decoded.functionArgsJson, JSON.stringify(["0x0b00", ["0x1234", "0xabcd"], "123"]));
  assert.equal(chainIdToKeeperHubNetwork(8453), "base");
  assert.equal(chainIdToKeeperHubNetwork(999999), undefined);
});

test("KeeperHub status normalization handles common terminal variants", () => {
  assert.equal(normalizeKeeperHubStatus("success"), "completed");
  assert.equal(normalizeKeeperHubStatus("ERRORED"), "failed");
  assert.equal(normalizeKeeperHubStatus("in_progress"), "running");
  assert.equal(normalizeKeeperHubStatus(undefined), "unknown");
});

test("KeeperHubClient submitUnsignedSwap sends structured contract-call and retries 429", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let calls = 0;

  globalThis.fetch = async (url, init) => {
    calls += 1;
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });

    if (calls === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }

    return new Response(JSON.stringify({ data: { executionId: "exec_1", status: "queued" } }), { status: 200 });
  };

  try {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      baseUrl: "https://keeperhub.test/api",
      timeoutMs: 1000,
      maxRetries: 1,
    });
    const res = await client.submitUnsignedSwap({
      to: "0x1111111111111111111111111111111111111111",
      data: encodedUniversalRouterCall(),
      value: "0x0",
      chainId: 8453,
    }, 1);

    assert.equal(res.ok, true);
    assert.equal(calls, 2);
    assert.equal(requests[1]?.url, "https://keeperhub.test/api/execute/contract-call");
    assert.equal(requests[1]?.body.contractAddress, "0x1111111111111111111111111111111111111111");
    assert.equal(requests[1]?.body.network, "base");
    assert.equal(requests[1]?.body.functionName, "execute");
    assert.equal(requests[1]?.body.value, "0");
    if (res.ok) {
      assert.equal(res.result.executionId, "exec_1");
      assert.equal(res.httpRetries, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KeeperHubClient refuses unsupported chain ids instead of defaulting to Ethereum", async () => {
  const client = new KeeperHubClient({
    apiKey: "kh_test",
    baseUrl: "https://keeperhub.test/api",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  const res = await client.submitUnsignedSwap({
    to: "0x1111111111111111111111111111111111111111",
    data: encodedUniversalRouterCall(),
    chainId: 999999,
  }, 999999);

  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /Unsupported KeeperHub network/);
});

test("KeeperHubExecutionPoller persists completed execution receipts and tx hash", async () => {
  const store = new InMemoryStore();
  store.addTrade("match_1", trade());

  const client = {
    getExecutionStatus: async (): Promise<{ ok: true; status: KeeperHubExecutionStatus; httpRetries: number }> => ({
      ok: true,
      httpRetries: 0,
      status: {
        executionId: "exec_1",
        status: "success",
        type: "contract-call",
        transactionHash: "0xabc",
        transactionLink: "https://explorer.test/tx/0xabc",
        gasUsedWei: "21000",
        result: { mined: true },
        error: null,
        raw: { status: "success" },
      },
    }),
  } as unknown as KeeperHubClient;

  const poller = new KeeperHubExecutionPoller(store, client, pollerConfig());
  (poller as unknown as { pending: Map<string, unknown> }).pending.set("exec_1", {
    matchId: "match_1",
    tradeRecordId: "trade_1",
    pollCount: 0,
    errorStreak: 0,
  });
  await (poller as unknown as { pollOne(executionId: string): Promise<void> }).pollOne("exec_1");

  const updated = store.getTrades("match_1")[0];
  assert.equal(updated?.keeperhubStatus, "completed");
  assert.equal(updated?.onChainTxHash, "0xabc");
  assert.equal(updated?.txHash, "0xabc");
  assert.equal(updated?.keeperhubTransactionLink, "https://explorer.test/tx/0xabc");
  assert.equal(updated?.executionReceipt?.executionId, "exec_1");
});

test("KeeperHubExecutionPoller marks repeated status read failures as failed", async () => {
  const store = new InMemoryStore();
  store.addTrade("match_1", trade());

  const client = {
    getExecutionStatus: async (): Promise<{ ok: false; error: string; httpRetries: number }> => ({
      ok: false,
      error: "status unavailable",
      httpRetries: 1,
    }),
  } as unknown as KeeperHubClient;

  const poller = new KeeperHubExecutionPoller(store, client, pollerConfig());
  (poller as unknown as { pending: Map<string, unknown> }).pending.set("exec_1", {
    matchId: "match_1",
    tradeRecordId: "trade_1",
    pollCount: 0,
    errorStreak: 0,
  });
  for (let i = 0; i < 12; i += 1) {
    await (poller as unknown as { pollOne(executionId: string): Promise<void> }).pollOne("exec_1");
  }

  const updated = store.getTrades("match_1")[0];
  assert.equal(updated?.keeperhubStatus, "failed");
  assert.match(updated?.lastExecutionError ?? "", /failed repeatedly/);
});
