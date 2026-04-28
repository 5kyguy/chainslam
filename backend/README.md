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
- **Python 3.11+** (for real-mode agent processes)
- **Docker** (for PostgreSQL)
- **Uniswap API key** (optional — set `UNISWAP_ENABLED=true` and `UNISWAP_API_KEY=...` for real price feeds)

## Environment

Copy `.env.example` to `.env` and adjust:

### General

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `CORS_ORIGIN` | `*` | Frontend origin allow-list |
| `BACKEND_MODE` | `dummy` | `dummy` uses simulated agents, `real` spawns Python agent processes |
| `DATABASE_URL` | `postgresql://agentslam:agentslam@localhost:5432/agentslam` | PostgreSQL connection string |

### Simulation (dummy mode)

| Variable | Default | Description |
| --- | --- | --- |
| `SIM_SEED` | `42` | Deterministic simulated behavior seed |
| `SIM_TICK_MS` | `2000` | Simulation tick interval in milliseconds |
| `SIM_ERROR_RATE` | `0` | Probability of simulated trade errors |

### Python Agents (real mode)

| Variable | Default | Description |
| --- | --- | --- |
| `AGENTS_PYTHON_PATH` | `python3` | Path to Python binary (or venv, e.g. `.venv/bin/python`) |
| `AGENTS_PACKAGE_DIR` | (empty) | Absolute path to the `agents/` directory containing `chain_slam_agents/` |

### LLM (reserved, not currently used by Python agents)

| Variable | Default | Description |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | Provider name |
| `LLM_API_KEY` | (empty) | API key |
| `LLM_MODEL` | `gpt-4o-mini` | Model identifier |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | API base URL |

### Uniswap (optional price feed)

| Variable | Default | Description |
| --- | --- | --- |
| `UNISWAP_ENABLED` | `false` | Enable real Uniswap price quotes |
| `UNISWAP_API_KEY` | (empty) | Uniswap Trading API key |
| `UNISWAP_CHAIN_ID` | `1` | Chain ID for price queries |
| `UNISWAP_TIMEOUT_MS` | `15000` | Request timeout |
| `UNISWAP_MAX_RETRIES` | `2` | Max retry count on failure |

## How Real Mode Works

In `BACKEND_MODE=real`, the match service spawns Python agent processes:

1. On match creation, `AgentProcessManager` spawns two Python processes (`python3 -m chain_slam_agents ...`).
2. Each Python process connects to the backend via WebSocket at `/ws/agent/:agentId`.
3. The backend sends a `tick` message with market context to each agent every 10 seconds.
4. Each agent runs its strategy, evaluates the tick, and returns a `decision` (buy/sell/hold).
5. The backend applies trades, tracks portfolios, and streams updates to the UI.
6. When the match ends, the backend sends `match_end` to both agents and kills the processes.

All trading is paper-based. The backend owns all portfolio state and trade execution — agents only evaluate and decide.

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
| `trades` | Trade history per match |
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
- `trade_executed` payload represents simulated execution result.
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
  "timestamp": "2026-04-27T07:00:00.000Z"
}
```

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

The smoke test runs in `dummy` mode and does not require PostgreSQL or Python.

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
