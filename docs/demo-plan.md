# Demo Plan

This document defines what a strong Agent Slam hackathon demo should show and provides a simple live script for presenting it.

## Demo Goal

The demo should prove that Agent Slam is a real, watchable agent-vs-agent trading arena rather than a static concept.

A successful demo shows:

- A backend server coordinating a live match as referee
- Two separate Python agent processes running different strategies
- WebSocket communication between backend and agents
- Live strategy reasoning visible in the decision feed
- Real or simulated market prices driving match ticks
- Optional KeeperHub execution status for live Uniswap swaps
- A final winner based on transparent portfolio valuation

## Setup Before The Demo

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install Python agent package
cd agents && pip install -e . && cd ..

# 3. Configure backend
cp backend/.env.example backend/.env
# Edit .env: set AGENTS_PACKAGE_DIR=/path/to/agentslam/agents

# 4. Start the backend
cd backend && npm run dev
```

Set `UNISWAP_API_KEY=...` to enable Uniswap Trading API price feeds. For the KeeperHub prize demo, run a mock match first, then set `UNISWAP_SWAP_MODE=live`, `KEEPERHUB_API_KEY=...`, and a very low `MAX_TRADE_USD_ABSOLUTE` for one canary execution.

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

| Time | Action |
| --- | --- |
| `0:00` | Open the UI and explain the arena: two strategies, same market, same starting capital, one winner |
| `0:20` | Select two strategies and a token pair, then start the match |
| `0:40` | Explain that the backend just spawned two Python processes, each running a different strategy |
| `1:00` | Highlight the decision feed and explain that each agent publishes plain-language reasoning |
| `1:30` | Show at least one trade flowing through and appearing in the trade history with PnL impact |
| `2:00` | For KeeperHub mode, show the execution id/status/tx hash or explorer link attached to the trade |
| `2:40` | Let the match end and show the winner screen with final portfolio values and match stats |
| `3:00` | Invite the judge or viewer to choose a different pair of strategies and run another match |

## Demo Risks

The fastest ways to lose clarity in the demo are:

- Too many moving parts on screen at once
- Unclear strategy names or unclear differences between strategies
- Slow or unreliable market/execution updates
- No visible explanation for why an agent traded
- No obvious final winner state
- Live execution failing without a clear fallback story; keep `UNISWAP_SWAP_MODE=mock` ready and show the recorded KeeperHub run if needed

The demo should bias toward simplicity and observability over ambitious market complexity.

## Stretch Goals

If the core loop is already stable, the following additions can make the demo stronger:

- Ranked match history
- Post-match analytics summary
- Volatility Duel or Altcoin Duel presets
- A quick rematch flow with different strategies
- Real Uniswap price feeds for live market data
- KeeperHub audit page or execution timeline for every live trade
