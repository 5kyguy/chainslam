# Demo Plan

This document defines what a strong Agent Slam hackathon demo should show and provides a simple live script for presenting it.

## Demo Goal

The demo should prove that Agent Slam is a real, watchable agent-vs-agent trading arena rather than a static concept.

A successful demo shows:

- A neutral Referee coordinating a live match
- Two separate Contender agents running different strategies
- AXL-based communication between agents
- Live strategy reasoning visible in the UI
- Uniswap-powered market interaction
- KeeperHub-backed execution or a clear execution abstraction
- A final winner based on transparent portfolio valuation

## What The Audience Should Understand

By the end of the demo, a viewer should understand four things:

1. Two agents are trading the same market under the same constraints.
2. Each strategy behaves differently and explains its choices.
3. The Referee makes the match fair and easy to follow.
4. The winner is determined by observable trading performance, not hidden heuristics.

## Suggested Match Setup

Use a setup that is easy to explain and likely to produce visible decision differences:

| Field | Recommendation |
| ----- | -------------- |
| Strategy A | Momentum Trader |
| Strategy B | Mean Reverter |
| Market | `WETH/USDC` |
| Starting capital | `1000 USDC` equivalent each |
| Match duration | `5 minutes` |
| Tick interval | `10-30 seconds` |

This creates a clean narrative because momentum and mean reversion typically react differently to the same market moves.

## Demo Script

| Time | Action |
| ---- | ------ |
| `0:00` | Open the UI and explain the arena: two strategies, same market, same starting capital, one winner |
| `0:20` | Select two strategies and a token pair, then start the match |
| `0:40` | Show the Referee and both Contenders running as separate agents communicating over AXL |
| `1:00` | Highlight the decision feed and explain that each agent publishes plain-language reasoning |
| `1:30` | Show at least one trade flowing through the execution layer and appearing in the trade history |
| `2:00` | Focus on the live leaderboard as the strategies diverge in PnL |
| `2:40` | Let the match end and show the winner screen with final portfolio values and match stats |
| `3:00` | Invite the judge or viewer to choose a different pair of strategies and run another match |

## Demo Risks

The fastest ways to lose clarity in the demo are:

- Too many moving parts on screen at once
- Unclear strategy names or unclear differences between strategies
- Slow or unreliable market/execution updates
- No visible explanation for why an agent traded
- No obvious final winner state

The demo should bias toward simplicity and observability over ambitious market complexity.

## Stretch Goals

If the core loop is already stable, the following additions can make the demo stronger:

- Ranked match history
- Post-match analytics summary
- Volatility Duel or Altcoin Duel presets
- A quick rematch flow with different strategies
