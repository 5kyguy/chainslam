# Technical Spec

This document describes the actual implementation contracts for the Agent Slam hackathon build.

## System Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Backend API | TypeScript / Fastify | Match orchestration, agent management, WebSocket streaming, trade execution |
| PostgreSQL | PostgreSQL 17 (Docker) | Persistent storage for agents, matches, trades, decisions, leaderboard |
| Python Agents | Python 3.11+ processes | Strategy evaluation (spawned per-match, communicate via WebSocket) |
| Uniswap API | REST (optional) | Real-time price quotes and optional swap calldata |
| KeeperHub | REST (optional) | Reliable onchain execution, polling, and audit receipts |
| UI | (frontend, separate) | Match setup, live leaderboard, decision feed, trade history |

## Project Structure

```bash
agentslam/
├── backend/                        # TypeScript Fastify server
│   ├── src/
│   │   ├── agents/
│   │   │   ├── agent-runtime.ts    # Legacy LLM agent (unused in real mode)
│   │   │   ├── process-manager.ts  # Spawns/kills Python agent processes
│   │   │   └── remote-agent.ts     # WS-based agent connection (tick → decision)
│   │   ├── config.ts               # Environment configuration
│   │   ├── integrations/
│   │   │   ├── tokens.ts           # Token addresses and decimals
│   │   │   ├── keeperhub.ts        # KeeperHub Direct Execution client
│   │   │   └── uniswap.ts          # Uniswap Trading API client
│   │   ├── routes/
│   │   │   ├── agent-routes.ts     # REST: /api/agents
│   │   │   ├── agent-ws-routes.ts  # WS: /ws/agent/:agentId
│   │   │   ├── http-routes.ts      # REST: /api/matches, strategies, leaderboard
│   │   │   └── ws-routes.ts        # WS: /ws/matches/:id
│   │   ├── services/
│   │   │   ├── agent-service.ts    # Agent CRUD and stats
│   │   │   ├── match-service.ts    # MatchService interface
│   │   │   ├── keeperhub-execution-poller.ts # KeeperHub status poller
│   │   │   ├── real-match-service.ts   # Real match engine (Python agents)
│   │   │   ├── service-factory.ts  # Creates RealMatchService
│   │   │   └── strategy-catalog.ts # Available strategy definitions
│   │   ├── store/
│   │   │   ├── in-memory-store.ts  # In-memory Store (used by tests)
│   │   │   ├── index.ts            # createStore factory
│   │   │   ├── postgres-store.ts   # PostgreSQL write-through Store
│   │   │   └── store.ts            # Store interface
│   │   ├── types.ts                # Shared TypeScript types
│   │   └── app.ts                  # Fastify app bootstrap
│   ├── tests/
│   │   └── smoke.ts                # Smoke test (in-memory store + stub process manager)
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
│       ├── types.py                # TickContext, StrategySignal, ActionType
│       └── strategies/
│           ├── __init__.py         # Strategy registry (STRATEGIES dict)
│           └── impl.py             # 6 strategy implementations
├── docs/
└── README.md
```

## Core Types

### Backend (TypeScript)

```typescript
// Match state tracked by the backend
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

// Sent to agents on each tick
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
}

// Agent response
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
4. Both `id` fields must match (e.g., `"my_strategy"`).

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
  "ticksRemaining": 25
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

### Trade event

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
  "keeperhubSubmissionId": "exec_...",
  "keeperhubStatus": "completed",
  "onChainTxHash": "0xabc..."
}
```

## Match Lifecycle

1. User creates two agents via `POST /api/agents` (each bound to a strategy).
2. User creates a match via `POST /api/matches` (selects two agents, token pair, capital, duration).
3. `RealMatchService` spawns two Python processes via `AgentProcessManager`.
4. Python agents connect to `/ws/agent/:agentId` via WebSocket.
5. After a 3-second connect wait, the tick loop starts (10-second interval).
6. On each tick:
   - Backend sends `tick` context to both agents in parallel.
   - Each agent evaluates its strategy and returns a `decision`.
   - Backend applies trades (buy/sell) or skips (hold).
   - In live mode, successful Uniswap swap calldata is submitted to KeeperHub and polled asynchronously.
   - Backend fetches latest price (Uniswap or simulated).
   - Backend recalculates portfolios and PnL.
   - Backend broadcasts `snapshot` event to UI clients.
7. When time runs out, the match is marked `completed`, agents are killed, and stats/leaderboard are updated.
8. A match can be stopped early via `POST /api/matches/:id/stop`.

## Match Rules

| Rule | Detail |
| --- | --- |
| Equal capital | Both agents start with identical USDC balance unless per-agent bankrolls are provided |
| Same market | Both agents trade the same token pair |
| Max trade size | 50% of starting capital per trade |
| Min trade size | Configured `MIN_TRADE_USD` |
| Tick interval | 10 seconds |
| Agent timeout | 8 seconds (defaults to hold) |
| Draw threshold | 0.25% PnL difference |

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

# LLM (reserved)
LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1

# Uniswap / KeeperHub
UNISWAP_API_KEY=
UNISWAP_CHAIN_ID=1
UNISWAP_SWAP_MODE=mock
UNISWAP_TIMEOUT_MS=15000
UNISWAP_MAX_RETRIES=2
KEEPERHUB_API_KEY=
KEEPERHUB_BASE_URL=https://app.keeperhub.com/api
```

## Resilience Rules

| Failure | Handling |
| --- | --- |
| Agent process crashes | Backend detects disconnect, defaults to hold for remaining ticks |
| Agent evaluate timeout | 8-second timeout, defaults to hold |
| Uniswap API error | Reuses previous tick price or falls back to paper math for trade sizing |
| KeeperHub submit/status error | Match continues; trade records `lastExecutionError` and retry metadata |
| Agent not connected at tick | Returns hold signal, match continues |
| Match stop requested | Backend kills both agent processes, releases agents to "ready" |

## Rating System

Agent Slam uses a simplified Elo-style rating for hackathon simplicity:

- Starting rating: 1200
- Draw threshold: 0.25% PnL difference
- Win/loss/draw results update both agents' ratings after each match

See [Ranking System](ranking-system.md) for full details.
