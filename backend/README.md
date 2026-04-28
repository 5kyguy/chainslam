# Agent Slam Backend

Fastify server powering the agent-vs-agent trading arena. PostgreSQL for persistence, real Uniswap price feeds optional, Python agent processes for strategy evaluation.

## Quick Start

```bash
# 1. Start the database
docker compose up -d

# 2. Install backend dependencies
cd backend && npm install

# 3. Install Python agent package in a venv (required on Arch and other PEP 668 distros)
cd ../agents && python -m venv .venv && . .venv/bin/activate && pip install -e .

# 4. Copy env and configure
cp backend/.env.example backend/.env

# 5. Run the server
cd backend && npm run dev
```

Server default: `http://localhost:8787`

## Prerequisites

- **Node.js 22+**
- **Python 3.11+** (for agent processes)
- **Docker** (for PostgreSQL)
- **Uniswap API key** (`UNISWAP_API_KEY=...`, required)

## Environment

Copy `.env.example` to **`backend/.env`** and adjust. On startup, the server loads that file into `process.env` (via `dotenv`), so variables like **`AGENTS_PYTHON_PATH`** apply even when you do not use `direnv` or shell exports.

### General

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `CORS_ORIGIN` | `*` | Frontend origin allow-list |
| `DATABASE_URL` | `postgresql://agentslam:agentslam@localhost:5432/agentslam` | PostgreSQL connection string |

### Python Agents

| Variable | Default | Description |
| --- | --- | --- |
| `AGENTS_PYTHON_PATH` | `python3` | Path to Python binary (or venv, e.g. `.venv/bin/python`) |
| `AGENTS_PACKAGE_DIR` | (auto) | Absolute path to the `agents/` directory. If unset, the backend resolves the repo’s `agents/` folder from its own path (so `python3 -m chain_slam_agents` works without `pip install -e`). Override if you run from a copied tree. |

### LLM (reserved, not currently used by Python agents)

| Variable | Default | Description |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | Provider name |
| `LLM_API_KEY` | (empty) | API key |
| `LLM_MODEL` | `gpt-4o-mini` | Model identifier |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | API base URL |

### Uniswap (Trading API — required)

| Variable | Default | Description |
| --- | --- | --- |
| `UNISWAP_API_KEY` | (required) | API key from [Uniswap developer dashboard](https://developers.uniswap.org/dashboard) |
| `UNISWAP_BASE_URL` | `https://trade-api.gateway.uniswap.org/v1` | Trading API base URL |
| `UNISWAP_CHAIN_ID` | `1` | Chain ID for quotes and approval checks |
| `UNISWAP_SWAPPER_ADDRESS` | Vitalik placeholder | Wallet address used as `swapper` in `/quote` and `walletAddress` in `/check_approval` (no funds needed for quote-only use) |
| `UNISWAP_TIMEOUT_MS` | `15000` | Request timeout |
| `UNISWAP_MAX_RETRIES` | `2` | Max retry count on failure |
| `UNISWAP_SWAP_MODE` | `mock` | `mock` = no `POST /swap`. **`live`** = real `POST /swap` after each trade quote; response unsigned tx is surfaced on `trade_executed` as `unsignedSwap` (you sign/broadcast — backend still keeps paper balances unless you add RPC broadcast). |
| `UNISWAP_PERMIT2_DISABLED` | `false` | Send `x-permit2-disabled: true` on quote/check/swap (proxy ERC-20 approve flow). Use **`true`** when running `live` swap without an EIP-712 signer in-process. |
| `UNISWAP_UNIVERSAL_ROUTER_VERSION` | `2.0` | Must stay consistent across quote and swap (Uniswap API). |
| `UNISWAP_PERMIT_SIGNATURE` | (empty) | Hex Permit2 signature when quotes return `permitData` and Permit2 is enabled. |

**Endpoints used:** `POST /quote`, `POST /check_approval`, and **`POST /swap`** when `UNISWAP_SWAP_MODE=live`.

**Supported pair symbols** (mainnet addresses in code): `WETH`, `USDC`, `USDT`, `DAI`, `WBTC`, `UNI`, `LINK`, plus raw `0x…` addresses.

### KeeperHub (Direct Execution — optional)

When **`KEEPERHUB_API_KEY`** is set and **`UNISWAP_SWAP_MODE=live`**, each trade with a successful **`POST /swap`** payload will also be submitted to KeeperHub **`POST /execute/contract-call`**. The backend decodes Universal Router `execute(bytes,bytes[],uint256)` / `execute(bytes,bytes[])` calldata with `viem`, forwards it as a structured contract call (same intent as the unsigned tx), and records **`keeperhubSubmissionId`**, status, retries, explorer link, and receipts on `trade_executed`. A background poller calls **`GET /execute/{executionId}/status`** until the execution completes or fails, then persists **`onChainTxHash`** / **`txHash`** when KeeperHub reports a mined transaction.

| Variable | Default | Description |
| --- | --- | --- |
| `KEEPERHUB_API_KEY` | (empty) | Organization API key (`X-API-Key`). If unset, swaps are not sent to KeeperHub (match loop continues unchanged). |
| `KEEPERHUB_BASE_URL` | `https://app.keeperhub.com/api` | KeeperHub API root (paths append `/execute/...`). |
| `KEEPERHUB_TIMEOUT_MS` | `30000` | HTTP timeout for submit/status |
| `KEEPERHUB_MAX_RETRIES` | `3` | Client retries on 429 / 5xx for submit/status |
| `KEEPERHUB_POLL_INTERVAL_MS` | `5000` | Background poll cadence for non-terminal executions |
| `KEEPERHUB_MAX_POLL_ATTEMPTS` | `120` | Max completed status polls while execution stays non-terminal |

If submission fails (decode error, HTTP error, wallet not configured on KeeperHub, etc.), the trade row still exists and **`lastExecutionError`** is set so the arena keeps running.

### 0G Storage — agent/match memory (Phase 7C, optional)

Parallel **memory timeline** for demos/bounties: decisions, trades, and match summaries are recorded by default (set **`ZEROG_ENABLED=false`** to disable). PostgreSQL remains the authoritative store for matches, trades, and leaderboard.

- **In-process timeline** is always populated when ZeroG memory is enabled (even without chain credentials).
- **KV writes** (`@0gfoundation/0g-ts-sdk`): when `ZEROG_EVM_RPC`, indexer/KV RPCs, `ZEROG_PRIVATE_KEY`, and **`ZEROG_KV_STREAM_ID`** are set, snapshots are flushed to 0G Storage debounced batch + on match completion/stop. Logs include **`txHash`** from successful puts for recordings/demos.
- Some public KV endpoints can lag significantly behind chain head; use `ZEROG_WRITE_COOLDOWN_MS` to avoid log spam/retry storms while nodes catch up.

| Variable | Default | Description |
| --- | --- | --- |
| `ZEROG_ENABLED` | `true` | Set `false` to disable the in-process memory timeline and 0G hooks. |
| `ZEROG_EVM_RPC` | (empty) | EVM JSON-RPC URL for signer + flow contracts. |
| `ZEROG_INDEXER_RPC` | (empty) | 0G indexer base URL for node selection / batcher. |
| `ZEROG_KV_RPC` | (empty) | KV service RPC for reads (`getValue`). |
| `ZEROG_PRIVATE_KEY` | (empty) | Hex private key with gas for KV writes. |
| `ZEROG_KV_STREAM_ID` | (empty) | KV stream id (`0x…`) for key namespace. |
| `ZEROG_KEY_PREFIX` | `agentslam/v1` | Prefix for keys: `{prefix}/match/{matchId}`, `{prefix}/agent/{agentId}`. |
| `ZEROG_MAX_RETRIES` | `3` | Retries on transient SDK/network errors. |
| `ZEROG_FLUSH_DEBOUNCE_MS` | `1200` | Ms to wait after activity before flushing a match snapshot to KV. |
| `ZEROG_WRITE_COOLDOWN_MS` | `300000` | Pause KV writes after a failed flush to avoid tight loops while the storage node is syncing. |

**Demo checklist**

1. Ensure memory is on (default) and set full `ZEROG_*` credentials from 0G testnet docs.
2. Start backend, run a short match; watch logs for `[ZeroGMemory] flushed match snapshot` and `txHash`.
3. `GET /api/matches/:id/memory` — paginated `events` with `schemaVersion`, `kind`, `payload`.
4. `GET /api/matches/:id/memory/zg` — optional raw JSON snapshot read from KV (`configured`, `raw`).
5. `GET /api/agents/:id/memory` — agent-scoped slice (includes events tagged with `agentId`).

See **`docs/PHASE_7C_0G_MEMORY.md`** for architecture notes and tradeoffs.

## How Match Execution Works

The match service always spawns Python agent processes:

1. On match creation, `AgentProcessManager` spawns two Python processes (`python3 -m chain_slam_agents ...`).
2. Each Python process connects to the backend via WebSocket at `/ws/agent/:agentId`.
3. The backend sends a `tick` message with market context to each agent every 10 seconds.
4. Each agent runs its strategy, evaluates the tick, and returns a `decision` (buy/sell/hold).
5. The backend applies trades, tracks portfolios, and streams updates to the UI.
6. When the match ends, the backend sends `match_end` to both agents and kills the processes.

Portfolio balances are always **paper** (no on-chain swap broadcast). Fill sizes follow **live Uniswap quotes** and **approval checks**; on quote errors, fills fall back to the spot price from the tick. If price fetch fails, the service reuses the previous tick price. The backend owns portfolio state — agents only evaluate and decide.

**Demo (real quotes, no capital):** `UNISWAP_API_KEY=…`, `UNISWAP_SWAP_MODE=mock`.

### Python Agent Strategies

| Strategy ID | Name | Description | Risk Profile |
| --- | --- | --- | --- |
| `dca` | DCA Bot | Buys fixed amounts at fixed intervals | Low |
| `momentum` | Momentum Trader | Buys into strength, sells into weakness | Medium |
| `mean_reverter` | Mean Reverter | Bets that extreme prices revert to the mean | Medium |
| `fear_greed` | Fear and Greed | Buys sharp drops, sells sharp rallies | Medium-High |
| `grid` | Grid Trader | Trades around predefined price bands | Low-Medium |
| `random` | Random Walk | Random trades as a control baseline | Chaos |

All strategies are purely algorithmic (no LLM dependency) for speed and reliability.

## Database

PostgreSQL 17 runs in Docker via `docker compose up -d`. Data persists in a named Docker volume (`pgdata`).

The schema is created automatically on first startup via `PostgresStore.init()`. All state (agents, matches, trades, decisions, leaderboard) survives restarts.

### Schema

| Table | Purpose |
| --- | --- |
| `agents` | Registered agents with stats |
| `matches` | Match state and contender data |
| `trades` | Trade history per match (`trade_record_id`, `execution_metadata` JSONB for Uniswap/KeeperHub audit fields) |
| `decisions` | Decision feed per match |
| `leaderboard` | Cached leaderboard rankings |

## API Contracts

### REST

| Endpoint | Purpose | Typical frontend use |
| --- | --- | --- |
| `POST /api/agents` | Register a new agent with a strategy | Called from agent setup form |
| `GET /api/agents` | List all registered agents | Agent selector dropdown |
| `GET /api/agents/:id` | Get single agent state | Agent detail view |
| `POST /api/matches` | Create a new match and start its lifecycle loop | Called from "Start Match" action |
| `GET /api/matches/:id` | Return current match snapshot (status, PnL, time remaining, contenders) | Poll or refresh current match state view |
| `GET /api/matches/:id/trades` | Return executed trade history for the match | Populate trade history panel/table |
| `GET /api/matches/:id/feed` | Return decision feed events (buy/sell/hold reasoning) | Populate live decision feed list |
| `GET /api/matches/:id/memory` | Paginated Phase 7C memory timeline (`limit`, `cursor`) — empty `events` if `ZEROG_ENABLED=false` | Replay / audit UI |
| `GET /api/matches/:id/memory/zg` | Raw snapshot string from 0G KV when configured (`configured`, `raw`) | Proof / bounty evidence |
| `GET /api/agents/:id/memory` | Paginated memory events for one agent (`limit`, `cursor`) | Agent-centric history |
| `POST /api/matches/:id/stop` | Stop an active match before natural completion | Called from "Stop Match" control |
| `GET /api/strategies` | List available strategy options | Build pre-match strategy selectors/dropdowns |
| `GET /api/leaderboard` | Return historical/derived ranking summary | Populate leaderboard page/widget |

### WebSocket

| Endpoint | Purpose | Typical frontend use |
| --- | --- | --- |
| `WS /ws/matches/:id` | Stream live updates for one match. Sends immediate snapshot on connect, then incremental events. | Keep UI in sync without polling |
| `WS /ws/agent/:agentId` | Backend-to-agent communication channel. Used by Python agent processes to receive ticks and send decisions. | Internal only (not for frontend) |

Event envelope shape:

```json
{
  "event": "snapshot | decision | trade_executed | completed | stopped",
  "match_id": "match_xxx",
  "timestamp": "2026-04-27T07:00:00.000Z",
  "payload": {}
}
```

Notes:

- `snapshot` payload is the full current match state.
- `decision` payload represents contender intent and reasoning.
- `trade_executed` payload represents simulated execution result. When Uniswap-sized fills are used, optional fields include `tradeRecordId`, `executionMode` (`uniswap_quote_mock` | `uniswap_live_swap` | `paper`), `quoteRouting`, `mockSwapBuild`, `unsignedSwap` (from real `POST /swap` when `UNISWAP_SWAP_MODE=live`), `swapRequestId`, `swapError`, `approvalRequestId`. With **`KEEPERHUB_API_KEY`** and live swap, optional **`keeperhubSubmissionId`**, **`keeperhubStatus`**, **`keeperhubRetryCount`**, **`onChainTxHash`**, **`executionReceipt`**, **`lastExecutionError`**, **`keeperhubTransactionLink`** appear as submission and polling progress.
- `completed` and `stopped` are terminal lifecycle events.

Decision event payload:

```json
{
  "event": "decision",
  "contender": "Momentum Trader",
  "action": "buy",
  "amount": 150,
  "reasoning": "Price action confirms trend continuation.",
  "confidence": 0.72,
  "timestamp": "2026-04-27T07:00:00.000Z"
}
```

Trade event payload:

```json
{
  "event": "trade_executed",
  "contender": "Momentum Trader",
  "txHash": "0xabc123",
  "sold": { "token": "USDC", "amount": 150 },
  "bought": { "token": "WETH", "amount": 0.044 },
  "gasUsd": 1.23,
  "timestamp": "2026-04-27T07:00:00.000Z",
  "executionMode": "uniswap_live_swap",
  "quoteRouting": "CLASSIC",
  "unsignedSwap": { "to": "0x66a9…", "data": "0x3593…", "value": "0x0", "chainId": 1, "gasLimit": "179302" },
  "swapRequestId": "dfc1bd88-c741-4cdb-b118-0dddb690bfef",
  "approvalRequestId": "req_…"
}
```

Optional fields are omitted when using legacy price-based paper fills (`executionMode`: `paper`).

**Match memory** (`GET /api/matches/:id/memory`) when the memory feature is enabled (default):

```json
{
  "events": [
    {
      "schemaVersion": 1,
      "kind": "match_started",
      "ts": "2026-04-28T12:00:00.000Z",
      "matchId": "…",
      "payload": {
        "matchId": "…",
        "tokenPair": "WETH/USDC",
        "startingCapitalUsd": 1000,
        "durationSeconds": 60,
        "contenderA": { "agentId": "…", "name": "…", "strategy": "momentum" },
        "contenderB": { "agentId": "…", "name": "…", "strategy": "dca" }
      }
    },
    {
      "schemaVersion": 1,
      "kind": "decision",
      "ts": "2026-04-28T12:00:10.000Z",
      "matchId": "…",
      "agentId": "…",
      "contenderName": "Momentum Trader",
      "payload": { "tickNumber": 1, "action": "hold", "amount": 0, "reasoning": "…", "confidence": 0.5 }
    }
  ],
  "nextCursor": null,
  "source": "memory",
  "lastTxHash": "0x…"
}
```

`lastTxHash` is set after a successful KV flush when chain credentials are configured.

### Agent WebSocket Protocol

The `/ws/agent/:agentId` endpoint uses a request-response protocol:

**Backend → Agent** (tick):

```json
{
  "type": "tick",
  "tokenPair": "WETH/USDC",
  "ethPrice": 3412.50,
  "priceHistory": [3400, 3405, 3410, 3412.50],
  "usdcBalance": 850,
  "ethBalance": 0.044,
  "portfolioUsd": 1000.15,
  "pnlPct": 0.015,
  "tradeCount": 1,
  "tickNumber": 5,
  "ticksRemaining": 25
}
```

**Agent → Backend** (decision):

```json
{
  "type": "decision",
  "action": "buy",
  "amount": 150,
  "reasoning": "Price up 3 ticks, momentum positive.",
  "confidence": 0.72
}
```

**Backend → Agent** (match end):

```json
{
  "type": "match_end",
  "reason": "completed"
}
```

If the agent does not respond within 8 seconds, the backend defaults to `hold`.

## Validation / QA

Unit tests (outcome helpers + ZeroG memory pagination/mapping):

```bash
npm run test:unit
```

Run the smoke test:

```bash
npm run test:smoke
```

The smoke script verifies:

1. Match creation
2. WS snapshot reception
3. Feed and trade retrieval
4. Memory API returns a `match_started` event (memory on by default unless disabled)
5. Stop endpoint
6. Leaderboard retrieval

The smoke test uses in-memory store + stubbed agent process manager, so it does not require PostgreSQL or Python.

Run both:

```bash
npm test
```

## Terminal UI (TUI)

Watch a live match in the terminal:

```bash
npm run tui
```

Customize strategies and parameters:

```bash
npm run tui -- --strategy-a=momentum --strategy-b=fear_greed --duration=60 --capital=500 --pair=WETH/USDC
```

Flags: `--base-url`, `--strategy-a`, `--strategy-b`, `--duration`, `--capital`, `--pair`

Controls: `q` to quit, `↑/↓` to scroll feed.

## Adding New Endpoints (Documentation Rules)

If you add a new API endpoint, update this README in the same PR. Follow this checklist:

1. Add the endpoint to the appropriate table (`REST` or `WebSocket`).
2. Include:
   - exact method + path
   - one-line purpose (what it does)
   - one-line frontend usage (where/why it is called)
3. If request/response shapes are non-trivial, add a JSON example below the table.
4. If it emits or changes WS events, update:
   - event envelope docs
   - event type notes
   - smoke test expectations in `tests/smoke.ts` when relevant
5. Keep naming consistent:
   - resource-first paths (for example, `/api/matches/:id/...`)
   - plural resource nouns (`matches`, `strategies`, `leaderboard`)
6. Prefer additive changes:
   - avoid silently changing existing payload fields
   - if a breaking contract change is unavoidable, call it out explicitly in this README under a short "Breaking Changes" note.
