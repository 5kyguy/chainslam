# Architecture

Agent Slam is a Fastify (TypeScript) backend that orchestrates head-to-head matches between Python agent processes. PostgreSQL persists all state; WebSocket streams live updates to the UI. A blessed-based terminal UI (TUI) provides a live arena view.

```bash
                        AGENT SLAM TUI
               live dashboard, strategy picker
                            |
                        HTTP / WS
                            |
                    ┌───────┴───────┐
                    │  Fastify API   │
                    │  (TypeScript)  │
                    └───┬───────┬───┘
                        |       |
              ┌─────────┘       └──────────┐
              |                             |
    ┌─────────┴─────────┐       ┌──────────┴──────────┐
    │  RealMatchService  │       │  AgentProcessManager │
    │  (Referee role)    │       │  spawn / kill procs  │
    └─────────┬─────────┘       └──────────┬──────────┘
              |                             |
        WS /ws/matches/:id          WS /ws/agent/:id
              |                        /        \
    ┌─────────┴─────────┐    ┌───────┴───┐  ┌────┴─────┐
    │    UI Clients      │    │ Python A  │  │ Python B │
    │  (TUI / frontend)  │    │ Strategy  │  │ Strategy │
    └────────────────────┘    └───────────┘  └──────────┘
                                    |
                          ┌─────────┴─────────┐
                          │ Uniswap Trading API│
                          │ prices + swap data │
                          └─────────┬─────────┘
                                    |
                    ┌───────────────┼───────────────┐
                    |               |               |
          ┌─────────┴─────────┐    |     ┌─────────┴─────────┐
          │ KeeperHub          │    │     │ 0G Storage         │
          │ reliable execution │    │     │ KV memory timeline │
          └───────────────────┘    │     └───────────────────┘
                                   │
                          ┌─────────┴─────────┐
                          │ PostgreSQL 17      │
                          │ persistent storage │
                          └───────────────────┘
```

## Backend Server (TypeScript / Fastify)

The backend is the referee and source of truth. It does not trade — it orchestrates.

Responsibilities:

- Register agents and manage their lifecycle state.
- Create matches, enforce rules, track PnL, and declare winners.
- Spawn Python agent processes on match start, kill them on match end.
- Own all portfolio balances and trade execution (paper trading).
- Stream live match updates to UI clients via WebSocket.
- Persist all state to PostgreSQL.
- Optionally flush match memory events to 0G Storage KV.
- Optionally submit live Uniswap swaps to KeeperHub for auditable onchain execution.

Key modules:

| Module | File | Purpose |
| --- | --- | --- |
| `RealMatchService` | `services/real-match-service.ts` | Match lifecycle, tick loop, portfolio tracking, Uniswap/KeeperHub/0G integration |
| `AgentProcessManager` | `agents/process-manager.ts` | Spawn and kill Python agent processes |
| `RemoteAgentConnection` | `agents/remote-agent.ts` | WS-based evaluate with 8s timeout |
| `AgentRegistry` | `agents/agent-registry.ts` | Agent CRUD via store |
| `AgentService` | `services/agent-service.ts` | Agent management facade |
| `StrategyCompiler` | `agents/strategies/strategy-compiler.ts` | Compiles strategy ID to prompt with guardrails |
| `PostgresStore` | `store/postgres-store.ts` | Write-through persistence |
| `UniswapClient` | `integrations/uniswap.ts` | Real price quotes, approval checks, and swap calldata |
| `KeeperHubClient` | `integrations/keeperhub.ts` | Universal Router calldata decoder + Direct Execution submission/status |
| `KeeperHubExecutionPoller` | `services/keeperhub-execution-poller.ts` | Async execution status polling and receipt persistence |
| `ZeroGMemoryService` | `services/zerog-memory-service.ts` | In-process event timeline with optional 0G KV flush |
| `ZeroGKvClient` | `integrations/zerog.ts` | 0G Storage KV read/write adapter |
| `computeMatchOutcome` | `services/match-outcome.ts` | Win/loss/draw determination (PnL gap + portfolio tie-break) |
| `clampMaxTradeUsd` | `services/trading-policy.ts` | Trade sizing policy (pct-of-capital + absolute cap) |
| `StrategyCatalog` | `services/strategy-catalog.ts` | Available strategy definitions |

## Python Agent Processes

Each contender runs as a separate Python process. The backend spawns them via `AgentProcessManager` and communicates over WebSocket.

### Agent Lifecycle

1. **Spawn**: On match creation, `AgentProcessManager.spawn()` starts `python3 -m chain_slam_agents --agent-id <id> --strategy <strategy> --ws-url <url>`.
2. **Connect**: The Python process connects to `/ws/agent/:agentId`. The `RemoteAgentConnection.register()` binds the socket.
3. **Tick loop**: Every 10 seconds, `RealMatchService` sends a `tick` message with market context (including `minTradeUsd` and `maxTradeUsd`). Each agent evaluates its strategy and returns a `decision`.
4. **End**: When the match ends or is stopped, the backend sends `match_end` and kills the process.

### Agent SDK (`agents/chain_slam_agents/`)

```bash
agents/
├── pyproject.toml
└── chain_slam_agents/
    ├── __init__.py
    ├── __main__.py         # Entry point
    ├── runner.py           # WS connection + message loop
    ├── base.py             # Strategy ABC
    ├── types.py            # TickContext, StrategySignal, ActionType, MatchInfo
    └── strategies/
        ├── __init__.py     # Strategy registry (STRATEGIES dict)
        └── impl.py         # All 6 strategy implementations
```

### Strategy Interface

```python
from abc import ABC, abstractmethod
from .types import TickContext, StrategySignal

class Strategy(ABC):
    @abstractmethod
    def evaluate(self, ctx: TickContext) -> StrategySignal: ...

    @abstractmethod
    def describe(self) -> str: ...
```

### Built-in Strategies

| ID | Name | Description | Risk |
| --- | --- | --- | --- |
| `dca` | DCA Bot | Buys fixed amounts at fixed intervals | Low |
| `momentum` | Momentum Trader | Buys into strength, sells into weakness | Medium |
| `mean_reverter` | Mean Reverter | Bets that extreme prices revert to the mean | Medium |
| `fear_greed` | Fear and Greed | Buys drops, sells rallies | Medium-High |
| `grid` | Grid Trader | Trades around predefined price bands (stateful) | Low-Medium |
| `random` | Random Walk | Random trades as a control baseline | Chaos |

All strategies are purely algorithmic — no LLM calls, fast and deterministic. Strategies respect server-provided `minTradeUsd` and `maxTradeUsd` bounds.

## Uniswap Integration

Uniswap is the market data and swap-construction layer. The backend fetches real prices from the Uniswap Trading API for match ticks. On API errors, it reuses the previous tick price.

- Trading API base URL: `https://trade-api.gateway.uniswap.org/v1`
- Uses `POST /quote` for price discovery and sized fills
- Uses `POST /check_approval` to verify token allowance state before execution
- Uses `POST /swap` in `UNISWAP_SWAP_MODE=live` to build unsigned Universal Router calldata
- Supports both classic (`amountIn`/`amountOut`) and UniswapX-style (`orderInfo`) quote formats
- Supports mainnet (chain ID 1) and Sepolia (chain ID 11155111) with built-in token addresses
- Supported token symbols: WETH, USDC, USDT, DAI, WBTC, UNI, LINK, plus raw `0x…` addresses

## KeeperHub Integration

When `KEEPERHUB_API_KEY` is set and `UNISWAP_SWAP_MODE=live`, each trade with a successful `/swap` payload is also submitted to KeeperHub for auditable onchain execution.

1. `UniswapClient` calls `POST /swap` to build unsigned Universal Router calldata.
2. `KeeperHubClient` decodes the `execute(bytes,bytes[],uint256)` calldata with `viem` and submits it to `POST /execute/contract-call`.
3. `KeeperHubExecutionPoller` polls `GET /execute/{executionId}/status` in the background.
4. Trade events are updated with `keeperhubSubmissionId`, normalized status, retries, receipt metadata, explorer link, and final tx hash.

Paper portfolio accounting remains the match source of truth so failed external execution does not break the arena.

## 0G Storage Memory

Agent Slam records an in-process event timeline for each match (decisions, trades, match lifecycle events). When 0G Storage credentials are configured (`ZEROG_EVM_RPC`, `ZEROG_KV_STREAM_ID`, etc.), snapshots are flushed to 0G KV debounced and on match completion/stop.

- Memory is enabled by default (`ZEROG_ENABLED=true`) and works in-process even without KV credentials.
- The timeline records: `match_started`, `decision`, `trade_executed`, `match_completed`, `match_stopped`.
- Flushes are debounced and skip hold decisions to minimize KV writes.
- A write cooldown prevents tight retry loops when the storage node is syncing.

## Match Outcome

Win/loss/draw is determined by `computeMatchOutcome()` in `services/match-outcome.ts`:

1. If the PnL% gap between contenders is >= 0.25%, the higher PnL contender wins.
2. If the PnL% gap is below 0.25%, the contender with the higher portfolio USD value wins.
3. If portfolio values are within $0.005, the match is a draw.

## Match Rules

| Rule | Description |
| --- | --- |
| Equal capital | Both contenders start with the same USDC balance unless per-agent bankrolls are explicitly provided |
| Same market | Both agents trade the same token pair |
| Position limits | No single trade can use more than 50% of starting capital |
| Absolute cap | Optional `MAX_TRADE_USD_ABSOLUTE` clamps trades for micro-capital tests |
| Minimum trade | Trades must meet the configured `MIN_TRADE_USD` |
| Transparent decisions | Every decision is broadcast before execution |
| Timeout protection | Agents that don't respond within 8 seconds default to hold |
| Parallel evaluation | Both agents are ticked simultaneously |

## Data Persistence

PostgreSQL 17 stores all durable state. `PostgresStore` extends `InMemoryStore` with a write-through pattern: all reads come from memory, all writes go to both memory and PostgreSQL. The schema is auto-created on startup.

| Table | Purpose |
| --- | --- |
| `agents` | Agent registration, stats, ratings |
| `matches` | Match state, contender data, PnL |
| `trades` | Trade history per match (includes `execution_metadata` JSONB for Uniswap/KeeperHub) |
| `decisions` | Decision feed per match |
| `leaderboard` | Cached leaderboard rankings |

## API Endpoints

### REST

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `POST` | `/api/agents` | Register a new agent |
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get agent state |
| `DELETE` | `/api/agents/:id` | Delete an agent |
| `GET` | `/api/agents/:id/memory` | Agent-scoped paginated memory timeline |
| `POST` | `/api/matches` | Create a match |
| `GET` | `/api/matches` | List matches (filterable by status, paginated) |
| `GET` | `/api/matches/:id` | Get match state |
| `GET` | `/api/matches/:id/trades` | Get trade history |
| `GET` | `/api/matches/:id/executions` | Get KeeperHub execution audit trail for live trades |
| `GET` | `/api/matches/:id/feed` | Get decision feed |
| `GET` | `/api/matches/:id/memory` | Paginated match memory timeline |
| `GET` | `/api/matches/:id/memory/zg` | Raw 0G KV snapshot |
| `POST` | `/api/matches/:id/stop` | Stop a match |
| `GET` | `/api/strategies` | List available strategies |
| `GET` | `/api/leaderboard` | Get leaderboard |

### WebSocket

| Endpoint | Purpose |
| --- | --- |
| `WS /ws/matches` | Global stream of all match events (for wall/arena views) |
| `WS /ws/matches/:id` | Stream live match updates to UI clients (snapshot + incremental events) |
| `WS /ws/agent/:agentId` | Agent communication channel (tick → decision, internal only) |

## Terminal UI (TUI)

A blessed-based terminal arena UI (`tui/arena.ts`) provides a multi-screen flow:

1. **Main Menu** — New Match / Leaderboard / Quit
2. **Strategy Selection** — Pick two agents from the strategy catalog
3. **Match Configuration** — Interactive form: token pair (fixed list), duration (presets), capital (input)
4. **Review & Confirm** — Summary of config before starting
5. **Live Match** — Contender panels, live feed, KeeperHub status
6. **Post-Match** — Winner announcement, options to start a new match or view leaderboard
7. **Leaderboard** — Ranked table of agents/strategies

Run with `npm run tui`. Flags: `--base-url`, `--strategy-a`, `--strategy-b`, `--duration`, `--capital`, `--pair`.

## Planned: Leaderboard Strategy Aggregation

When "Bring Your Own Agent" is enabled, the leaderboard should support grouping by strategy across multiple agents:

- `GET /api/leaderboard?groupBy=strategy` — Aggregate stats by strategy ID
- `Store.getLeaderboardByStrategy()` — SQL `GROUP BY strategy` in PostgresStore
- Fields: composite rating (average of agent ratings), total wins/losses/draws, average PnL%, total matches
- The existing `LeaderboardEntry` type gains an optional `strategyId` field for BYOA context
