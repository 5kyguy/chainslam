# Demo Plan

This document defines what a strong Agent Slam hackathon demo should show and provides a simple live script for presenting it.

## Demo Goal

The demo should prove that Agent Slam is a real, watchable agent-vs-agent trading arena rather than a static concept.

A successful demo shows:

- A backend server coordinating a live match as referee
- Two separate Python agent processes running different strategies
- WebSocket communication between backend and agents
- Live strategy reasoning visible in the decision feed
- Real Uniswap price quotes driving match ticks
- Optional KeeperHub execution status for live Uniswap swaps
- Optional 0G Storage match memory persistence
- A final winner based on transparent portfolio valuation

## Setup Before The Demo

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install backend + Python agents
cd backend && npm install
cd ../agents && python -m venv .venv && . .venv/bin/activate && pip install -e .

# 3. Configure backend
cp backend/.env.example backend/.env
# Edit .env: set UNISWAP_API_KEY=... and AGENTS_PYTHON_PATH to agents/.venv/bin/python

# 4. Start the backend
cd backend && npm run dev
```

Set `UNISWAP_API_KEY=...` to enable Uniswap Trading API price feeds. For the KeeperHub prize demo, run a mock match first, then switch to the [Sepolia KeeperHub canary runbook](keeperhub-integration.md#sepolia-canary-runbook): live swap mode, KeeperHub wallet as `UNISWAP_SWAPPER_ADDRESS`, narrow USDC allowance, and `MAX_TRADE_USD_ABSOLUTE=0.1`. For the 0G prize demo, set `ZEROG_*` credentials and verify `txHash` in logs after a match.

## What The Audience Should Understand

By the end of the demo, a viewer should understand four things:

1. Two agents are trading the same market under the same constraints.
2. Each strategy behaves differently and explains its choices.
3. The backend server acts as a neutral referee making the match fair and easy to follow.
4. The winner is determined by observable trading performance, not hidden heuristics.

## Suggested Match Setup

Use a setup that is easy to explain and likely to produce visible decision differences:

| Field | Recommendation |
| --- | --- |
| Strategy A | Momentum Trader |
| Strategy B | Mean Reverter |
| Market | `WETH/USDC` |
| Starting capital | `1000 USDC` equivalent each |
| Match duration | `5 minutes` |
| Tick interval | `10 seconds` |

This creates a clean narrative because momentum and mean reversion typically react differently to the same market moves.

## Demo Script

### Option A: Terminal UI (TUI)

```bash
npm run tui -- --strategy-a=momentum --strategy-b=mean_reverter --duration=300 --capital=1000 --pair=WETH/USDC
```

| Time | Action |
| --- | --- |
| `0:00` | Launch the TUI and explain the arena: two strategies, same market, same starting capital, one winner |
| `0:20` | Select two strategies and press Enter to start the match |
| `0:40` | Point out that the backend just spawned two Python processes, each running a different strategy |
| `1:00` | Highlight the live feed and explain that each agent publishes plain-language reasoning |
| `1:30` | Show at least one trade flowing through and appearing in the feed with PnL impact on the contender panels |
| `2:00` | For KeeperHub mode: show execution id, completed status, Etherscan tx link, and `GET /api/matches/:id/executions` |
| `2:00` | For 0G mode: explain that match events are being persisted to 0G Storage KV |
| `2:40` | Let the match end and show the winner announcement with final portfolio values |
| `3:00` | Show the memory API: `curl localhost:8787/api/matches/:id/memory` or `localhost:8787/api/matches/:id/memory/zg` |
| `3:30` | Invite the judge or viewer to choose a different pair of strategies and run another match |

### Option B: API-only (curl)

| Time | Action |
| --- | --- |
| `0:00` | Create two agents via `POST /api/agents` |
| `0:15` | Create a match via `POST /api/matches` |
| `0:30` | Watch the match via `GET /api/matches/:id` or a WS client |
| `1:00` | Show the decision feed via `GET /api/matches/:id/feed` |
| `1:30` | Show trade history via `GET /api/matches/:id/trades` |
| `2:00` | Show KeeperHub executions via `GET /api/matches/:id/executions` (live mode) |
| `2:30` | Show match memory via `GET /api/matches/:id/memory` |
| `3:00` | Let the match complete, show leaderboard via `GET /api/leaderboard` |

## Demo Risks

The fastest ways to lose clarity in the demo are:

- Too many moving parts on screen at once
- Unclear strategy names or unclear differences between strategies
- Slow or unreliable market/execution updates
- No visible explanation for why an agent traded
- No obvious final winner state
- Live execution failing without a clear fallback story; keep `UNISWAP_SWAP_MODE=mock` ready and keep the verified Sepolia KeeperHub tx link from the runbook available

The demo should bias toward simplicity and observability over ambitious market complexity.

## Stretch Goals

If the core loop is already stable, the following additions can make the demo stronger:

- Ranked match history with leaderboard
- Post-match analytics summary
- Volatility Duel or Altcoin Duel presets
- A quick rematch flow with different strategies
- Real Uniswap price feeds for live market data
- KeeperHub audit page or execution timeline for every live trade
- 0G Storage KV read-back showing persistent match memory with tx hashes
