# Match Types

For V1, Agent Slam should focus on spot token trading on Uniswap. This matches the current architecture, keeps execution simple, and makes matches easy to understand for both builders and spectators.

## V1 Direction

Agents trade spot token pairs against each other using the same rules, the same execution layer, and the same starting capital.

Recommended V1 format:

- Both agents trade the same Uniswap market.
- Both agents start with identical capital.
- Both agents use the same execution configuration.
- The winner is determined by final portfolio value at the end of the match.

This keeps the arena fair and makes strategy quality the main differentiator.

## Supported V1 Markets

The first version should use major liquid token pairs such as:

| Category | Example Pairs |
| -------- | ------------- |
| Major pair duels | `WETH/USDC`, `WBTC/USDC` |
| Altcoin duels | `UNI/USDC`, `LINK/USDC`, `ARB/USDC` |
| Volatility show matches | A higher-volatility pair selected for more dramatic live matches |

Major pairs are the safest default because they are liquid, recognizable, and easier to reason about in a live demo.

## What The Agents Actually Do

In V1, agents are spot traders. They do not manage prediction positions, derivatives, or liquidity provision.

Agents can implement strategies such as:

- Momentum trading
- Mean reversion
- DCA or interval buying
- Breakout trading
- Dip buying
- Random baseline trading

Each agent watches market conditions, evaluates its strategy, explains its reasoning, and then buys, sells, or holds.

## Why Spot Tokens First

Spot token matches are the best V1 choice because:

- They already match the current Uniswap-based architecture.
- Pricing and execution are straightforward.
- The audience can understand the match immediately.
- Strategy comparisons are cleaner than in more specialized markets.

## Deferred Match Types

The following options are valid future expansions, but should not be part of V1:

| Match Type | Why It Is Deferred |
| ---------- | ------------------ |
| Polymarket / prediction markets | Event-driven markets require different strategy logic and different execution assumptions |
| Perpetuals or futures | Adds leverage, liquidation risk, and venue-specific complexity |
| LP or market-making matches | Changes the game from trading direction to liquidity management |
| Options or volatility trading | Requires more advanced pricing and risk handling |
| Cross-venue arbitrage | Shifts the competition toward execution and routing rather than strategy alone |

Polymarket is especially interesting, but it should be treated as a separate future mode rather than part of the initial Agent Slam arena.

## Recommended V1 Match Menu

For the first release, the UI should expose a small, clear set of match types:

| Match Type | Description |
| ---------- | ----------- |
| Major Pair Duel | Two agents trade a major pair such as `WETH/USDC` |
| Altcoin Duel | Two agents trade a selected altcoin pair |
| Volatility Duel | Two agents trade a higher-volatility pair for a more dramatic match |

This gives enough variety for demos without expanding the implementation surface too early.
