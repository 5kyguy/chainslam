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

## Demo Settings

Use a conservative canary setup for judging:

```bash
UNISWAP_CHAIN_ID=11155111
UNISWAP_SWAP_MODE=live
UNISWAP_PERMIT2_DISABLED=true
KEEPERHUB_API_KEY=...
MIN_TRADE_USD=0.1
MAX_TRADE_USD_ABSOLUTE=1
DEFAULT_PER_AGENT_STARTING_CAPITAL_USD=1
ZEROG_ENABLED=false
```

For Sepolia, built-in `WETH/USDC` resolves to Sepolia WETH and Circle test USDC. Set `UNISWAP_SWAPPER_ADDRESS` to the KeeperHub organization wallet address, then fund that wallet with Sepolia ETH and the test tokens/approvals needed for the swap. Run a mock match first with `UNISWAP_SWAP_MODE=mock`, then switch to live for one short match.

## Judge-Facing Evidence

- `GET /api/matches/:id/trades` shows full trade events, including raw execution metadata.
- `GET /api/matches/:id/executions` shows the KeeperHub audit projection for each live execution.
- The TUI prints KeeperHub status updates as WebSocket trade events are refreshed.
- PostgreSQL persists KeeperHub metadata in `trades.execution_metadata`, so execution receipts survive server restarts.

## Why KeeperHub Matters Here

Agent Slam is not just a trading simulator. KeeperHub turns agent intent into an auditable execution pipeline: autonomous agents make decisions, Uniswap supplies executable swap calldata, and KeeperHub handles submission, retries, status tracking, and receipts. That gives the arena a trustworthy execution trail that judges can inspect instead of relying on logs or a black-box wallet.
