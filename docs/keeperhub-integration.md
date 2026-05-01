# KeeperHub Integration

Agent Slam uses KeeperHub as the execution reliability layer for agent-generated trades. This is an **optional** integration — the arena runs fully in paper-trading mode by default.

The arena remains the referee: agents decide whether to buy, sell, or hold, and the backend records portfolio/PnL for the match. When live execution is enabled (`UNISWAP_SWAP_MODE=live` + `KEEPERHUB_API_KEY`), the same trade intent also flows through Uniswap and KeeperHub so the demo can show auditable onchain execution.

## Implementation

- **`integrations/keeperhub.ts`** — `KeeperHubClient` class: decodes Universal Router `execute(bytes,bytes[],uint256)` / `execute(bytes,bytes[])` / proxy 6-arg calldata using `viem` ABI decoding. Submits structured contract calls to `POST /execute/contract-call`. Supports 10+ chain ID to KeeperHub network mappings. Includes `normalizeKeeperHubStatus()` for 15+ status strings.
- **`services/keeperhub-execution-poller.ts`** — Background poller: registers pending executions, polls `GET /execute/{executionId}/status` at configurable intervals, persists receipts and tx hashes to the store, publishes WS updates, marks 12-consecutive-failure streaks as failed.

## Flow

1. A Python agent receives a tick and returns a buy/sell decision.
2. The backend sizes the trade under the match risk rules (`min(50% of starting capital, MAX_TRADE_USD_ABSOLUTE)`).
3. `UniswapClient` requests a real quote via `POST /quote` and checks approval via `POST /check_approval`.
4. In live mode, `UniswapClient` calls `POST /swap` to build unsigned Universal Router calldata.
5. `KeeperHubClient.decodeUniversalRouterExecuteCalldata()` decodes the calldata with `viem`.
6. `KeeperHubClient.submitUnsignedSwap()` submits the decoded call to `POST /execute/contract-call`.
7. `KeeperHubExecutionPoller.register()` adds the execution to the pending set and starts polling.
8. On status change, the poller updates the store and publishes a `trade_executed` WS event with updated metadata.
9. Trade events include `keeperhubSubmissionId`, normalized status, retry count, explorer link, and final tx hash.

The core match loop remains resilient: if KeeperHub submission or polling fails, the match continues and the trade records `lastExecutionError`.

## Sepolia Canary Runbook

A canary is a tiny live execution that proves the full path works before running a larger demo. Use Sepolia, the KeeperHub organization wallet, and a narrow USDC allowance.

### 1. Configure Live Sepolia Mode

```bash
UNISWAP_CHAIN_ID=11155111
UNISWAP_SWAP_MODE=live
UNISWAP_PERMIT2_DISABLED=true
UNISWAP_SWAPPER_ADDRESS=<keeperhub_wallet_address>
KEEPERHUB_API_KEY=...
MIN_TRADE_USD=0.1
MAX_TRADE_USD_ABSOLUTE=0.1
DEFAULT_PER_AGENT_STARTING_CAPITAL_USD=1
ZEROG_ENABLED=false
```

For Sepolia, built-in `WETH/USDC` resolves to Sepolia WETH and Circle test USDC. `UNISWAP_SWAPPER_ADDRESS` must be the KeeperHub wallet address because Uniswap builds calldata with that wallet as `from`.

You can read the KeeperHub wallet address with:

```bash
cd backend
node -e 'import("dotenv").then(async ({ default: dotenv }) => {
  dotenv.config({ path: ".env" });
  const key = process.env.KEEPERHUB_API_KEY;
  const base = (process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com/api").replace(/\/$/, "");
  const res = await fetch(base + "/user", {
    headers: { accept: "application/json", "X-API-Key": key, Authorization: `Bearer ${key}` }
  });
  const json = await res.json();
  const data = json.data || json;
  console.log(data.walletAddress || data.wallet?.address);
});'
```

### 2. Fund And Approve

Fund the KeeperHub wallet with Sepolia ETH for gas and Sepolia USDC for the input token. For the `$0.10` canary, `0.05` Sepolia ETH and `1` Sepolia USDC are enough.

Ask Uniswap for the exact approval transaction before approving:

```bash
cd backend
node -e 'import("dotenv").then(async ({ default: dotenv }) => {
  dotenv.config({ path: ".env" });
  const wallet = process.env.UNISWAP_SWAPPER_ADDRESS;
  const body = {
    walletAddress: wallet,
    token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    amount: "100000",
    chainId: 11155111
  };
  const res = await fetch("https://trade-api.gateway.uniswap.org/v1/check_approval", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.UNISWAP_API_KEY,
      "x-permit2-disabled": "true"
    },
    body: JSON.stringify(body)
  });
  console.log(await res.text());
});'
```

For the current Sepolia proxy flow, the spender returned by Uniswap is:

```text
0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9
```

Approve a narrow `1 USDC` allowance through KeeperHub:

```bash
cd backend
node -e 'import("dotenv").then(async ({ default: dotenv }) => {
  dotenv.config({ path: ".env" });
  const key = process.env.KEEPERHUB_API_KEY;
  const base = (process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com/api").replace(/\/$/, "");
  const body = {
    contractAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    network: "sepolia",
    functionName: "approve",
    functionArgs: JSON.stringify([
      "0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9",
      "1000000"
    ]),
    abi: JSON.stringify([{
      type: "function",
      name: "approve",
      stateMutability: "nonpayable",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [{ name: "", type: "bool" }]
    }]),
    value: "0",
    gasLimitMultiplier: "1.2"
  };
  const res = await fetch(base + "/execute/contract-call", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-API-Key": key,
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  console.log(res.status, await res.text());
});'
```

Verify allowance before running the match:

```bash
node -e 'import("dotenv").then(async ({ default: dotenv }) => { dotenv.config({ path: ".env" }); const wallet=process.env.UNISWAP_SWAPPER_ADDRESS; const usdc="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; const spender="0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9"; const rpc="https://ethereum-sepolia-rpc.publicnode.com"; const pad=a=>a.toLowerCase().replace(/^0x/,"").padStart(64,"0"); const res=await fetch(rpc,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:usdc,data:"0xdd62ed3e"+pad(wallet)+pad(spender)},"latest"]})}); const json=await res.json(); console.log(Number(BigInt(json.result))/1e6,"USDC allowance"); });'
```

### 3. Run The Canary

Start Postgres and backend:

```bash
cd backend
docker compose up -d
npm run dev
```

Run a short TUI match with DCA as one contender so at least one tiny buy is attempted:

```bash
npm run tui -- --strategy-a=dca --strategy-b=momentum --duration=30 --capital=1 --pair=WETH/USDC
```

Stop after the first live trade if you only need proof. Then inspect:

```bash
curl localhost:8787/api/matches/:id/executions
curl localhost:8787/api/matches/:id/trades
```

Successful evidence should include `keeperhubStatus: "completed"`, `onChainTxHash`, and `keeperhubTransactionLink`.

## Allowance Strategy

- Default to **narrow allowances** for demos. Approve only the expected live notional plus a small buffer, for example `1 USDC` for a `$0.10` canary.
- Keep `MAX_TRADE_USD_ABSOLUTE` low while live mode is enabled. The approval controls token pull capacity; the cap controls per-trade intent.
- Avoid unlimited approvals for demo wallets unless the wallet is disposable and testnet-only.
- Re-check allowance before each live run with Uniswap `/check_approval` or direct `allowance(owner, spender)`.
- After a judging/demo session, either leave a small testnet allowance or set approval back to `0` if the wallet will be reused for other experiments.
- For mainnet, use an isolated wallet, small allowances, and a manual approval/revocation checklist. Do not reuse broad hackathon approvals.

## Verified Sepolia Evidence

The current Sepolia integration has been validated end to end with a `$0.10` USDC -> WETH canary:

- KeeperHub execution: `qcxd1ndchcp610fr0s10a`
- Transaction: `0x6e5520c7d8e9f006ab88615e9409a8eeab9b9f3dabc2bec884c0269724b44bcc`
- Explorer: `https://sepolia.etherscan.io/tx/0x6e5520c7d8e9f006ab88615e9409a8eeab9b9f3dabc2bec884c0269724b44bcc`

## Judge-Facing Evidence

- `GET /api/matches/:id/trades` shows full trade events, including raw execution metadata.
- `GET /api/matches/:id/executions` shows the KeeperHub audit projection for each live execution.
- The TUI prints KeeperHub status updates as WebSocket trade events are refreshed.
- PostgreSQL persists KeeperHub metadata in `trades.execution_metadata`, so execution receipts survive server restarts.

## Why KeeperHub Matters Here

Agent Slam is not just a trading simulator. KeeperHub turns agent intent into an auditable execution pipeline: autonomous agents make decisions, Uniswap supplies executable swap calldata, and KeeperHub handles submission, retries, status tracking, and receipts. That gives the arena a trustworthy execution trail that judges can inspect instead of relying on logs or a black-box wallet.
