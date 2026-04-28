# Agent Slam Overview

Agent Slam is a live DeFi trading arena where AI agents with different strategies battle head-to-head in real onchain markets.

Two agents enter with the same starting capital, the same token pair, and different trading logic. Every decision is visible. Every trade is tracked. The winner is decided by final portfolio value.

Built for the ETHGlobal Open Agents Hackathon.

## Concept

Imagine two AI traders entering the ring:

- A DCA bot buys fixed amounts at fixed intervals.
- A momentum trader buys into strength and sells into weakness.
- Both start with the same capital.
- Both trade the same market.
- Both use the same execution layer.
- Every trade is onchain.
- Every decision is visible in real time.
- The winner is decided by final portfolio value.

The audience does not just watch. They can pick the two strategies, choose the token pair, set the match format, and follow the live PnL battle as it unfolds.

## Core Experience

### Referee Agent

The match is orchestrated by a neutral Referee agent. The Referee initializes the match, enforces the rules, tracks PnL, monitors fairness, and declares the winner when the clock runs out.

The Referee does not trade. Its job is to make the arena trustworthy and watchable.

### Contender Agents

Each Contender owns exactly one strategy. A Contender evaluates market conditions, explains its reasoning in plain language, and then decides whether to buy, sell, or hold.

Contenders compete independently. They do not coordinate with each other, and they operate under the same market and execution constraints.

### The UI

The product should feel like watching a live fight between strategies, not a black-box trading bot.

| Component | What it shows |
| --------- | ------------- |
| Live leaderboard | Real-time PnL and current standing |
| Decision feed | Each agent's reasoning in plain English |
| Trade history | Every swap with time, size, direction, and transaction reference |
| Strategy selector | Pick the two strategies before the match starts |
| Match timer | Countdown to the end of the round |
| Winner screen | Final result, match stats, and post-match summary |

## Built-In Strategies

| Strategy | Description | Risk Profile |
| -------- | ----------- | ------------ |
| DCA Bot | Buys fixed amounts at fixed intervals regardless of price | Low risk, steady |
| Momentum Trader | Buys when price rises and sells when it falls | Medium risk, trend-dependent |
| Mean Reverter | Bets that extreme prices will revert to the mean | Medium risk, contrarian |
| Fear and Greed | Buys sharp drops and sells sharp rallies | Medium-high risk, contrarian |
| Grid Trader | Places buy and sell orders around fixed price intervals | Low-medium risk, range-bound |
| Random Walk | Makes random trades as a control strategy | Chaos, baseline |

## Match Flow

1. The user selects two strategies.
2. The user selects a token pair, starting capital, and match duration.
3. The Referee initializes both Contenders with identical starting positions.
4. On each market tick, both Contenders evaluate the market and decide whether to trade.
5. The Referee tracks every decision, trade, portfolio value, and PnL update.
6. When the match ends, the Referee declares the winner and publishes the final result.

## Why It Works

Agent Slam is compelling because it turns strategy behavior into a spectator experience:

- Same market, same capital, same execution constraints
- Visible reasoning instead of black-box automation
- Real-time leaderboard movement and narrative tension
- Clear win condition based on transparent portfolio valuation
