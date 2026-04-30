# Technical Spec

This document describes the implemented contracts for Agent Slam.

## System Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Backend API | TypeScript / Fastify 5 | Match orchestration, agent management, WebSocket streaming, trade execution, 0G memory |
| PostgreSQL | PostgreSQL 17 (Docker) | Persistent storage for agents, matches, trades, decisions, leaderboard |
| Python Agents | Python 3.11+ processes | Strategy evaluation (spawned per-match, communicate via WebSocket) |
| Uniswap API | REST (`POST /quote`, `/check_approval`, `/swap`) | Real-time price quotes, approval checks, optional swap calldata |
| KeeperHub | REST (optional) | Reliable onchain execution, polling, and audit receipts |
| 0G Storage | KV SDK (optional) | Persistent match memory timeline |
| TUI | blessed (Node.js) | Terminal arena UI with strategy picker and live dashboard |

## Project Structure

```bash
agentslam/
├── backend/                        # TypeScript Fastify server
│   ├── src/
│   │   ├── agents/
│   │   │   ├── agent-registry.ts   # Agent CRUD via store
│   │   │   ├── process-manager.ts  # Spawns/kills Python agent processes
│   │   │   ├── remote-agent.ts     # WS-based agent connection (tick → decision)
│   │   │   └── strategies/
│   │   │       └── strategy-compiler.ts  # Compiles strategy ID to prompt with guardrails
│   │   ├── config.ts               # Environment configuration (85+ fields)
│   │   ├── integrations/
│   │   │   ├── tokens.ts           # Token addresses, decimals, unit conversion
│   │   │   ├── keeperhub.ts        # KeeperHub Direct Execution client + calldata decoder
│   │   │   ├── uniswap.ts          # Uniswap Trading API client (quote, approval, swap)
│   │   │   └── zerog.ts            # 0G Storage KV read/write adapter
│   │   ├── load-env.ts             # dotenv loader for backend/.env
│   │   ├── routes/
│   │   │   ├── agent-routes.ts     # REST: /api/agents (CRUD)
│   │   │   ├── agent-ws-routes.ts  # WS: /ws/agent/:agentId
│   │   │   ├── http-routes.ts      # REST: /api/matches, strategies, leaderboard, memory, health
│   │   │   └── ws-routes.ts        # WS: /ws/matches/:id
│   │   ├── schemas/
│   │   │   └── contracts.ts        # JSON schema validators (match creation, pagination)
│   │   ├── services/
│   │   │   ├── agent-service.ts    # Agent management facade
│   │   │   ├── keeperhub-execution-poller.ts # KeeperHub background status poller
│   │   │   ├── match-outcome.ts    # Win/loss/draw determination
│   │   │   ├── match-service.ts    # MatchService interface
│   │   │   ├── real-match-service.ts   # Real match engine (831 lines)
│   │   │   ├── service-factory.ts  # Assembles RealMatchService + integrations
│   │   │   ├── strategy-catalog.ts # Available strategy definitions
│   │   │   ├── trading-policy.ts   # Trade sizing clamps
│   │   │   └── zerog-memory-service.ts # 0G memory timeline + KV flush
│   │   ├── store/
│   │   │   ├── in-memory-store.ts  # In-memory Store (used by tests)
│   │   │   ├── index.ts            # createStore factory → PostgresStore
│   │   │   ├── postgres-store.ts   # PostgreSQL write-through Store
│   │   │   └── store.ts            # Store interface
│   │   ├── types.ts                # Shared TypeScript types
│   │   ├── app.ts                  # Fastify app bootstrap + wiring
│   │   └── server.ts               # Entry point
│   ├── tui/
│   │   └── arena.ts                # Blessed terminal arena UI
│   ├── tests/
│   │   ├── match-outcome.test.ts   # Match outcome unit tests
│   │   ├── trading-policy.test.ts  # Trade sizing unit tests
│   │   ├── zerog-memory.test.ts    # 0G memory unit tests
│   │   ├── keeperhub.test.ts       # KeeperHub decode + poller tests
│   │   └── smoke.ts                # Integration smoke test
│   ├── docker-compose.yml          # PostgreSQL 17 only
│   ├── .env.example
│   └── package.json
├── agents/                         # Python agent package
│   ├── pyproject.toml
│   └── chain_slam_agents/
│       ├── __init__.py
│       ├── __main__.py             # Entry: python -m chain_slam_agents
│       ├── runner.py               # WebSocket client + message loop
│       ├── base.py                 # Strategy ABC
│       ├── types.py                # TickContext, StrategySignal, ActionType, MatchInfo
│       └── strategies/
│           ├── __init__.py         # Strategy registry (STRATEGIES dict)
│           └── impl.py             # 6 strategy implementations
├── docs/
├── town/                           # Design documents for future multi-agent ecosystem
└── README.md
```

## Core Types

### Backend (TypeScript)

```typescript
interface MatchState {
  id: string;
  status: "created" | "running" | "completed" | "stopped";
  tokenPair: string;
  startingCapitalUsd: number;
  durationSeconds: number;
  timeRemainingSeconds: number;
  ethPrice: number;
  contenders: { A: ContenderState; B: ContenderState };
}

interface TickContext {
  tokenPair: string;
  ethPrice: number;
  priceHistory: number[];
  usdcBalance: number;
  ethBalance: number;
  portfolioUsd: number;
  pnlPct: number;
  tradeCount: number;
  tickNumber: number;
  ticksRemaining: number;
  minTradeUsd: number;
  maxTradeUsd: number;
}

interface StrategySignal {
  action: "buy" | "sell" | "hold";
  amount: number;
  reasoning: string;
  confidence: number;
}
```

### Python Agent SDK

```python
from dataclasses import dataclass
from enum import Enum

class ActionType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"

@dataclass
class StrategySignal:
    action: ActionType
    amount: float
    reasoning: str
    confidence: float

@dataclass
class TickContext:
    token_pair: str
    eth_price: float
    price_history: list[float]
    usdc_balance: float
    eth_balance: float
    portfolio_usd: float
    pnl_pct: float
    trade_count: int
    tick_number: int
    ticks_remaining: int
    min_trade_usd: float = 10.0
    max_trade_usd: float = 1_000_000.0

@dataclass
class MatchInfo:
    match_id: str
    token_pair: str
    starting_capital_usd: float
    contender_side: str
```

## Strategy Interface

```python
from abc import ABC, abstractmethod
from .types import TickContext, StrategySignal

class Strategy(ABC):
    @abstractmethod
    def evaluate(self, ctx: TickContext) -> StrategySignal: ...

    @abstractmethod
    def describe(self) -> str: ...
```

To add a new strategy:

1. Create a class extending `Strategy` in `agents/chain_slam_agents/strategies/impl.py`.
2. Register it in `agents/chain_slam_agents/strategies/__init__.py` (add to `STRATEGIES` dict).
3. Add the corresponding entry in `backend/src/services/strategy-catalog.ts`.
4. Add a prompt template in `backend/src/agents/strategies/strategy-compiler.ts`.
5. Both `id` fields must match (e.g., `"my_strategy"`).

## WebSocket Agent Protocol

The `/ws/agent/:agentId` endpoint uses a request-response protocol between the backend and Python agent processes.

### Tick (backend → agent)

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
  "ticksRemaining": 25,
  "minTradeUsd": 0.1,
  "maxTradeUsd": 500
}
```

### Decision (agent → backend)

```json
{
  "type": "decision",
  "action": "buy",
  "amount": 150,
  "reasoning": "Price up 3 ticks, momentum positive.",
  "confidence": 0.72
}
```

### Match end (backend → agent)

```json
{
  "type": "match_end",
  "reason": "completed"
}
```

The backend enforces an 8-second timeout on evaluate calls. Agents that do not respond in time default to `hold`.

## WebSocket UI Protocol

The `/ws/matches/:id` endpoint streams events to frontend clients.

### Event envelope

```json
{
  "event": "snapshot | decision | trade_executed | completed | stopped",
  "match_id": "match_xxx",
  "timestamp": "2026-04-27T07:00:00.000Z",
  "payload": {}
}
```

### Decision event

```json
{
  "event": "decision",
  "contender": "Momentum Trader",
  "action": "buy",
  "amount": 150.0,
  "reasoning": "ETH up 1.2% - bullish trend detected",
  "confidence": 0.72,
  "timestamp": "2026-04-27T07:00:00.000Z"
}
```

### Trade event (paper mode)

```json
{
  "event": "trade_executed",
  "contender": "Momentum Trader",
  "txHash": "0xdef456...",
  "sold": { "token": "USDC", "amount": 150.0 },
  "bought": { "token": "ETH", "amount": 0.044 },
  "gasUsd": 1.23,
  "timestamp": "2026-04-27T07:00:00.000Z"
}
```

### Trade event (live Uniswap + KeeperHub)

```json
{
  "event": "trade_executed",
  "contender": "Momentum Trader",
  "txHash": "0xdef456...",
  "sold": { "token": "USDC", "amount": 150.0 },
  "bought": { "token": "ETH", "amount": 0.044 },
  "gasUsd": 1.23,
  "timestamp": "2026-04-27T07:00:00.000Z",
  "executionMode": "uniswap_live_swap",
  "unsignedSwap": { "to": "0x66a9…", "data": "0x3593…", "value": "0x0", "chainId": 1, "gasLimit": "179302" },
  "swapRequestId": "dfc1bd88-c741-4cdb-b118-0dddb690bfef",
  "keeperhubSubmissionId": "exec_...",
  "keeperhubStatus": "completed",
  "onChainTxHash": "0xabc..."
}
```

### Match memory event (0G Storage timeline)

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
    }
  ],
  "nextCursor": null,
  "source": "memory",
  "lastTxHash": "0x…"
}
```

## Match Lifecycle

1. User creates two agents via `POST /api/agents` (each bound to a strategy).
2. User creates a match via `POST /api/matches` (selects two agents, token pair, capital, duration). Per-agent bankrolls supported via `startingCapitalUsdA` / `startingCapitalUsdB`.
3. `RealMatchService` spawns two Python processes via `AgentProcessManager`.
4. Python agents connect to `/ws/agent/:agentId` via WebSocket.
5. After a 3-second connect wait, the tick loop starts (10-second interval).
6. On each tick:
   - Backend sends `tick` context to both agents in parallel.
   - Each agent evaluates its strategy and returns a `decision`.
   - Backend applies trades: in mock mode uses Uniswap quotes for sizing; in live mode calls `POST /swap` for unsigned calldata.
   - If KeeperHub is configured, successful swaps are submitted for onchain execution.
   - Backend fetches latest price (Uniswap or reuse previous tick price on error).
   - Backend recalculates portfolios and PnL.
   - Backend broadcasts `snapshot` event to UI clients.
   - 0G memory records the decision and trade events.
7. When time runs out, `computeMatchOutcome()` determines win/loss/draw, the match is marked `completed`, agents are killed, stats/leaderboard are updated, and 0G memory records `match_completed`.
8. A match can be stopped early via `POST /api/matches/:id/stop`.

## Match Outcome

Two-tier comparison:

1. If `abs(pnlA - pnlB) >= 0.25%`, the higher-PnL contender wins.
2. If the PnL gap is smaller, the contender with the higher `portfolioUsd` wins.
3. If `abs(portfolioA - portfolioB) < 0.005`, the match is a draw.

## Match Rules

| Rule | Detail |
| --- | --- |
| Equal capital | Both agents start with identical USDC balance unless per-agent bankrolls are provided |
| Same market | Both agents trade the same token pair |
| Max trade size | `min(50% of starting capital, MAX_TRADE_USD_ABSOLUTE)` per trade |
| Min trade size | Configured `MIN_TRADE_USD` (default 0.1) |
| Tick interval | 10 seconds |
| Agent timeout | 8 seconds (defaults to hold) |
| Draw threshold | 0.25% PnL difference + $0.005 portfolio epsilon |

## Environment Variables

```bash
# Server
PORT=8787
HOST=0.0.0.0
CORS_ORIGIN=*

# Database
DATABASE_URL=postgresql://agentslam:agentslam@localhost:5432/agentslam

# Python agents
AGENTS_PYTHON_PATH=python3
AGENTS_PACKAGE_DIR=/path/to/agentslam/agents

# LLM (reserved, not used by current Python agents)
LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1

# Uniswap Trading API (required)
UNISWAP_API_KEY=
UNISWAP_BASE_URL=https://trade-api.gateway.uniswap.org/v1
UNISWAP_CHAIN_ID=1
UNISWAP_SWAPPER_ADDRESS=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
UNISWAP_TIMEOUT_MS=15000
UNISWAP_MAX_RETRIES=2
UNISWAP_SWAP_MODE=mock
UNISWAP_PERMIT2_DISABLED=false
UNISWAP_UNIVERSAL_ROUTER_VERSION=2.0
UNISWAP_PERMIT_SIGNATURE=

# Trading policy
MIN_TRADE_USD=0.1
MAX_TRADE_USD_ABSOLUTE=
DEFAULT_PER_AGENT_STARTING_CAPITAL_USD=1000

# KeeperHub (optional)
KEEPERHUB_API_KEY=
KEEPERHUB_BASE_URL=https://app.keeperhub.com/api
KEEPERHUB_TIMEOUT_MS=30000
KEEPERHUB_MAX_RETRIES=3
KEEPERHUB_POLL_INTERVAL_MS=5000
KEEPERHUB_MAX_POLL_ATTEMPTS=120

# 0G Storage (optional, memory on by default)
ZEROG_ENABLED=true
ZEROG_EVM_RPC=
ZEROG_INDEXER_RPC=
ZEROG_KV_RPC=
ZEROG_PRIVATE_KEY=
ZEROG_KV_STREAM_ID=
ZEROG_KEY_PREFIX=agentslam/v1
ZEROG_MAX_RETRIES=3
ZEROG_FLUSH_DEBOUNCE_MS=1200
ZEROG_WRITE_COOLDOWN_MS=300000
```

## Resilience Rules

| Failure | Handling |
| --- | --- |
| Agent process crashes | Backend detects disconnect, defaults to hold for remaining ticks |
| Agent evaluate timeout | 8-second timeout, defaults to hold |
| Uniswap `/quote` error | Reuses previous tick price; trade fills fall back to spot price |
| Uniswap `/swap` error | Trade still recorded with `swapError`; match continues |
| KeeperHub submit error | Trade row exists with `lastExecutionError`; match continues |
| KeeperHub poll failures | 12 consecutive failures marks execution as failed; match continues |
| 0G KV write failure | Cooldown prevents tight retry loops; in-process memory unaffected |
| Agent not connected at tick | Returns hold signal, match continues |
| Match stop requested | Backend kills both agent processes, releases agents to "ready" |

## Rating System

Agent Slam uses a simplified Elo-style rating:

- Starting rating: 1200
- Draw threshold: 0.25% PnL difference (via `computeMatchOutcome`)
- Win/loss/draw results update both agents' ratings after each match

See [Ranking System](ranking-system.md) for full details.

## Testing

### Unit tests

```bash
npm run test:unit
```

Covers: match outcome logic, trade sizing policy, 0G memory pagination/flushing, KeeperHub calldata decoding and poller.

### Smoke test

```bash
npm run test:smoke
```

Integration test using in-memory store + stubbed process manager. Verifies: agent creation, match creation, WS snapshot, memory API, feed/trades/executions retrieval, stop, leaderboard.

### Full suite

```bash
npm test
```

## Terminal UI

```bash
npm run tui
npm run tui -- --strategy-a=momentum --strategy-b=fear_greed --duration=60 --capital=500 --pair=WETH/USDC
```

Flags: `--base-url`, `--strategy-a`, `--strategy-b`, `--duration`, `--capital`, `--pair`.
Controls: `q` to quit, `↑/↓` to scroll feed.
