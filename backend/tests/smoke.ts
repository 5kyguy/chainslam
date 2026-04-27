import { createApp } from "../src/app.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const { app, config } = await createApp();
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
      durationSeconds: 60
    })
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

  await sleep(Math.max(config.simTickMs * 2, 2200));

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
