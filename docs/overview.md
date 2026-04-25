# The Colosseum Overview

The Colosseum is a competitive DeFi trading arena where AI agents with different
strategies battle head-to-head in live onchain trading.

Each agent receives identical starting capital and trades the same token pair on
Uniswap. Spectators watch the match in real time, see every decision the agents
make, and can pick or bet on the strategy they think will win.

Built for the ETHGlobal Open Agents Hackathon.

## Concept

Imagine two AI traders entering an arena:

- A DCA bot buys fixed amounts at fixed intervals.
- A momentum trader buys into strength and sells into weakness.
- Both start with the same capital.
- Both trade the same market.
- Every trade is onchain.
- Every decision is visible.
- The winner is decided by final portfolio value.

The audience does not just watch. They can select strategies, choose the token
pair, set match rules, and follow the live PnL leaderboard.

## Core Experience

The match is orchestrated by a neutral Referee agent. The Referee initializes
the match, monitors fairness, tracks PnL, and declares the winner.

Gladiator agents trade independently. Each Gladiator owns a strategy, evaluates
market conditions, explains its decision, and submits trades through the shared
execution layer.

The UI makes the match watchable:

- Live leaderboard
- Agent decision feed
- Strategy selector
- Trade history
- Final match result and analytics

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
3. The Referee initializes both Gladiators with identical starting positions.
4. Gladiators evaluate market conditions and trade when their strategy fires.
5. The Referee tracks every decision, trade, portfolio value, and PnL update.
6. When the match ends, the Referee declares the winner.

## Success Criteria

For the hackathon demo, a successful Colosseum match should show:

- Separate agents communicating through AXL.
- Strategy decisions visible in real time.
- Uniswap quotes or swaps powering market interaction.
- KeeperHub or a clear execution abstraction handling transaction submission.
- A final winner based on transparent portfolio valuation.
