# Match Types

## Implemented (V1)

Agent Slam supports spot token paper-trading with real Uniswap price feeds and optional live execution.

### Current Format

- Both agents trade the same Uniswap market (same token pair).
- Both agents start with identical capital (or per-agent bankrolls via `startingCapitalUsdA` / `startingCapitalUsdB`).
- Prices come from the Uniswap Trading API (`POST /quote`).
- Trading is paper-based by default (`UNISWAP_SWAP_MODE=mock`), with real quote sizing.
- In live mode (`UNISWAP_SWAP_MODE=live`), `POST /swap` builds unsigned Universal Router calldata, optionally submitted to KeeperHub.
- The winner is determined by final portfolio value via `computeMatchOutcome()`.

### Supported Markets

Built-in token addresses for mainnet (chain ID 1) and Sepolia (chain ID 11155111):

| Category | Token Symbols |
| -------- | ------------- |
| Major | `WETH`, `WBTC` |
| Stablecoins | `USDC`, `USDT`, `DAI` |
| DeFi | `UNI`, `LINK` |
| Raw addresses | Any `0x…` token address |

Any pair can be used in a match (e.g., `WETH/USDC`, `WBTC/USDC`, `UNI/USDC`).

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

## Possible Future Match Types

| Match Type | Description |
| ---------- | ----------- |
| Major Pair Duel | Two agents trade a major pair such as `WETH/USDC` (already supported) |
| Altcoin Duel | Two agents trade a selected altcoin pair (already supported) |
| Volatility Duel | Two agents trade a higher-volatility pair for a more dramatic match (already supported) |
| Per-agent bankrolls | Different starting capital per agent (already supported via API) |
