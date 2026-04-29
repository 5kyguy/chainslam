# KeeperHub Integration

Agent Slam uses KeeperHub as the execution reliability layer for agent-generated trades.

The arena remains the referee: agents decide whether to buy, sell, or hold, and the backend records portfolio/PnL for the match. When live execution is enabled, the same trade intent also flows through Uniswap and KeeperHub so the demo can show auditable onchain execution.

## Flow

1. A Python agent receives a tick and returns a buy/sell decision.
2. The backend sizes the trade under the match risk rules.
3. `UniswapClient` requests a real quote and, in live mode, calls Uniswap `/swap` to build unsigned Universal Router calldata.
4. `KeeperHubClient` decodes the Universal Router `execute(...)` calldata with `viem` and submits it to KeeperHub `POST /execute/contract-call`.
5. `KeeperHubExecutionPoller` polls `GET /execute/{executionId}/status`.
6. Trade events are updated with `keeperhubSubmissionId`, normalized status, retries, receipt metadata, explorer link, and final transaction hash when available.

The core API remains resilient: if KeeperHub submission or polling fails, the match loop continues and the trade records `lastExecutionError`.

## Demo Settings

Use a conservative canary setup for judging:

```bash
UNISWAP_SWAP_MODE=live
KEEPERHUB_API_KEY=...
MIN_TRADE_USD=0.1
MAX_TRADE_USD_ABSOLUTE=1
DEFAULT_PER_AGENT_STARTING_CAPITAL_USD=1
```

Fund the configured swapper/KeeperHub execution wallet with minimal balances and approvals only. Run a mock match first with `UNISWAP_SWAP_MODE=mock`, then switch to live for one short match.

## Judge-Facing Evidence

- `GET /api/matches/:id/trades` shows full trade events, including raw execution metadata.
- `GET /api/matches/:id/executions` shows the KeeperHub audit projection for each live execution.
- The TUI prints KeeperHub status updates as WebSocket trade events are refreshed.
- PostgreSQL persists KeeperHub metadata in `trades.execution_metadata`, so execution receipts survive server restarts.

## Why KeeperHub Matters Here

Agent Slam is not just a trading simulator. KeeperHub turns agent intent into an auditable execution pipeline: autonomous agents make decisions, Uniswap supplies executable swap calldata, and KeeperHub handles submission, retries, status tracking, and receipts. That gives the arena a trustworthy execution trail that judges can inspect instead of relying on logs or a black-box wallet.
