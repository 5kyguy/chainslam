# Chain Slam Backend

Backend server for Chain Slam match orchestration, agent strategy execution, live websocket updates, Uniswap market integration, and optional KeeperHub-backed onchain execution.

## Quick Start

```bash
npm install
npm run dev
```

Server default: `http://localhost:8787`

## Environment

Copy `.env.example` and adjust as needed:

- `BACKEND_MODE=dummy|real` (`dummy` uses deterministic simulation; `real` uses agent runtimes and optional external integrations)
- `SIM_SEED` for deterministic simulated behavior
- `SIM_TICK_MS` simulation tick interval in milliseconds
- `SIM_ERROR_RATE` reserved for future fault injection
- `CORS_ORIGIN` frontend origin allow-list (or `*` for local development)
- `UNISWAP_ENABLED`, `UNISWAP_API_KEY`, `UNISWAP_CHAIN_ID`, `UNISWAP_SWAPPER_ADDRESS` for real-mode market access
- `KEEPERHUB_ENABLED`, `KEEPERHUB_API_KEY`, `KEEPERHUB_NETWORK`, `KEEPERHUB_AUTH_MODE` for KeeperHub-backed execution

KeeperHub real-mode defaults target Sepolia:

```bash
BACKEND_MODE=real
UNISWAP_ENABLED=true
UNISWAP_API_KEY=...
UNISWAP_CHAIN_ID=11155111
KEEPERHUB_ENABLED=true
KEEPERHUB_API_KEY=...
KEEPERHUB_NETWORK=sepolia
KEEPERHUB_AUTH_MODE=bearer
```

## API Contracts

### REST

| Endpoint | Purpose | Typical frontend use |
| --- | --- | --- |
| `POST /api/matches` | Create a new simulated match and start its lifecycle loop. | Called from "Start Match" action. |
| `GET /api/matches/:id` | Return current match snapshot (status, PnL, time remaining, contenders). | Poll or refresh current match state view. |
| `GET /api/matches/:id/trades` | Return executed trade history for the match. | Populate trade history panel/table. |
| `GET /api/matches/:id/executions` | Return trade lifecycle events, including KeeperHub submitted/executed/failed records. | Populate execution/audit panels. |
| `GET /api/matches/:id/feed` | Return decision feed events (`buy`/`sell`/`hold` reasoning). | Populate live decision feed list. |
| `POST /api/matches/:id/stop` | Stop an active match before natural completion. | Called from "Stop Match" control. |
| `GET /api/strategies` | List available strategy options. | Build pre-match strategy selectors/dropdowns. |
| `GET /api/leaderboard` | Return historical/derived ranking summary. | Populate leaderboard page/widget. |

### WebSocket

| Endpoint | Purpose | Typical frontend use |
| --- | --- | --- |
| `WS /ws/matches/:id` | Stream live updates for one match. Sends immediate snapshot on connect, then incremental events. | Keep UI in sync without polling (`snapshot`, `decision`, `trade_submitted`, `trade_executed`, `trade_failed`, `completed`, `stopped`). |

Event envelope shape:

```json
{
  "event": "snapshot | decision | trade_submitted | trade_executed | trade_failed | completed | stopped",
  "match_id": "match_xxx",
  "timestamp": "2026-04-27T07:00:00.000Z",
  "payload": {}
}
```

Notes:

- `snapshot` payload is the full current match state.
- `decision` payload represents contender intent and reasoning.
- `trade_submitted` payload represents a KeeperHub execution submission.
- `trade_executed` payload represents completed execution. In real KeeperHub mode it includes execution audit fields.
- `trade_failed` payload represents a failed execution attempt. Portfolio balances are not mutated for failed trades.
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
  "executionProvider": "keeperhub",
  "executionStatus": "completed",
  "keeperExecutionId": "direct_123",
  "transactionHash": "0xabc123",
  "transactionLink": "https://sepolia.etherscan.io/tx/0xabc123",
  "idempotencyKey": "chain-slam:match_123:momentum:1:buy:USDC:150",
  "timestamp": "2026-04-27T07:00:00.000Z"
}
```

Error responses use a consistent envelope:

```json
{
  "error": {
    "code": "MATCH_NOT_FOUND",
    "message": "Match not found",
    "requestId": "..."
  }
}
```

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

## Validation / QA

Run the smoke test:

```bash
npm run test:smoke
```

The smoke script verifies:

1. Match creation
2. WS snapshot reception
3. Feed and trade retrieval
4. Stop endpoint
5. Leaderboard retrieval

## Match Simulation Script

After starting the backend, run:

```bash
npm run simulate:match
```

What it does:

1. Calls `POST /api/agents` twice to create two agents.
2. Calls `POST /api/matches` to start a match.
3. Subscribes to `WS /ws/matches/:id`.
4. Pretty-prints websocket JSON events (`snapshot`, `decision`, `trade_submitted`, `trade_executed`, `trade_failed`, `completed`/`stopped`).
5. Prints final match results summary (status, winner, PnL, feed/trade counts).

### Silent mode

For service/integration testing where you do not want websocket output:

```bash
npm run simulate:match -- --silent
```

`--silent` behavior:

- still logs API call responses for both agent creation calls and match creation
- does not subscribe to websocket events
- exits immediately after API setup calls

### Optional flags

```bash
npm run simulate:match -- --base-url=http://127.0.0.1:8787 --duration=45 --token-pair=WETH/USDC --starting-capital=1000
```

- `--base-url` (default: `http://127.0.0.1:8787`)
- `--duration` seconds (minimum: `30`)
- `--token-pair` (default: `WETH/USDC`)
- `--starting-capital` USD (minimum: `10`)
