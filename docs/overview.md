# Agent Slam Overview

Agent Slam is a live trading arena where AI agents with different strategies battle head-to-head in paper-traded markets.

Two agents enter with the same starting capital, the same token pair, and different trading logic. Every decision is visible. Every trade is tracked. The winner is decided by final portfolio value.

Built for the ETHGlobal Open Agents Hackathon.

## Concept

Imagine two AI traders entering the ring:

- A DCA bot buys fixed amounts at fixed intervals.
- A momentum trader buys into strength and sells into weakness.
- Both start with the same capital.
- Both trade the same market.
- Every decision is visible in real time.
- The winner is decided by final portfolio value.

The audience does not just watch. They can pick the two strategies, choose the token pair, set the match format, and follow the live PnL battle as it unfolds.

## Core Experience

### Backend Server (Referee Role)

The match is orchestrated by a TypeScript Fastify server that acts as the neutral referee. It initializes matches, enforces rules, tracks PnL, monitors fairness, and declares the winner when the clock runs out.

The server does not trade. Its job is to make the arena trustworthy and watchable.

### Python Agent Processes (Contenders)

Each Contender is a Python process running a single strategy. The backend spawns one process per contender when a match starts and kills them when it ends. Agents communicate with the backend over WebSocket — they receive market context on each tick and respond with buy/sell/hold decisions.

Contenders compete independently. They do not coordinate with each other, and they operate under the same market and execution constraints.

### The UI

The product should feel like watching a live fight between strategies, not a black-box trading bot.

| Component | What it shows |
| --- | --- |
| Live leaderboard | Real-time PnL and current standing |
| Decision feed | Each agent's reasoning in plain English |
| Trade history | Every trade with time, size, direction, and gas cost |
| Strategy selector | Pick the two strategies before the match starts |
| Match timer | Countdown to the end of the round |
| Winner screen | Final result, match stats, and post-match summary |

## Built-In Strategies

| Strategy | Description | Risk Profile |
| --- | --- | --- |
| DCA Bot | Buys fixed amounts at fixed intervals regardless of price | Low risk, steady |
| Momentum Trader | Buys when price rises and sells when it falls | Medium risk, trend-dependent |
| Mean Reverter | Bets that extreme prices will revert to the mean | Medium risk, contrarian |
| Fear and Greed | Buys sharp drops and sells sharp rallies | Medium-high risk, contrarian |
| Grid Trader | Places buy and sell orders around fixed price intervals | Low-medium risk, range-bound |
| Random Walk | Makes random trades as a control strategy | Chaos, baseline |

All strategies are purely algorithmic — no LLM dependency — for speed, reliability, and predictable behavior.

## Match Flow

1. The user selects two strategies.
2. The user selects a token pair, starting capital, and match duration.
3. The backend spawns two Python agent processes, one for each contender.
4. Both agents connect via WebSocket and the tick loop begins.
5. On each tick (every 10 seconds), both agents evaluate the market and decide whether to trade.
6. The backend tracks every decision, trade, portfolio value, and PnL update.
7. When the match ends, the backend kills the agent processes, declares the winner, and updates ratings.

## Price Feeds and Execution

Prices are sourced from the Uniswap Trading API (`/quote`) using your configured API key. By default the arena uses paper accounting with real quote sizing. In live mode, Uniswap `/swap` builds unsigned Universal Router calldata and KeeperHub submits/polls the execution, giving each agent trade an auditable execution trail.

## Why It Works

Agent Slam is compelling because it turns strategy behavior into a spectator experience:

- Same market, same capital, same execution constraints
- Visible reasoning instead of black-box automation
- Real-time leaderboard movement and narrative tension
- Clear win condition based on transparent portfolio valuation
