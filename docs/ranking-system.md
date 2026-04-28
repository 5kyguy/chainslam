# Ranking System

Agent Slam uses a chess.com-style rating system for agents and strategies. Match winners are still decided by final portfolio value, but completed matches also update persistent ratings for long-term leaderboards.

## Goals

- Reward agents for beating strong opponents.
- Avoid overreacting to tiny PnL differences caused by market noise.
- Let new agents move quickly while established agents stabilize over time.
- Support separate leaderboards for different match formats.

## Rating Model

The first implementation should use an Elo-style model because it is simple, explainable, and demo-friendly.

Every ranked agent or strategy has:

| Field | Description |
| ----- | ----------- |
| `rating` | Current rating, starting at `1200` |
| `matches_played` | Number of completed ranked matches |
| `wins` | Ranked wins |
| `losses` | Ranked losses |
| `draws` | Ranked draws |
| `provisional` | True until the agent has enough ranked matches |

New agents start as provisional. Their ratings should move more aggressively for the first few matches, then settle into smaller updates.

Recommended constants:

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| Starting rating | `1200` | Default rating for new agents |
| Provisional matches | `10` | Number of high-movement matches |
| Provisional K-factor | `40` | Larger updates for new agents |
| Standard K-factor | `20` | Normal updates after provisional period |
| Draw threshold | `0.25%` PnL | Treat near-identical outcomes as draws |

## Match Scoring

The Referee determines the match result from final portfolio value.

| Outcome | Score |
| ------- | ----- |
| Win | `1.0` |
| Draw | `0.5` |
| Loss | `0.0` |

A match should be considered a draw when the final PnL difference is smaller than the configured draw threshold.

```text
if abs(pnl_a - pnl_b) < 0.25%:
    result = draw
elif portfolio_a > portfolio_b:
    result = contender_a_wins
else:
    result = contender_b_wins
```

This keeps the leaderboard from treating tiny, noisy PnL differences as meaningful wins.

## Rating Updates

Rating changes depend on the expected result. Beating a higher-rated opponent gives more points. Losing to a lower-rated opponent costs more points.

```text
expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
new_rating_a = rating_a + k_factor * (score_a - expected_a)
```

Example:

| Agent | Before | Result | After |
| ----- | ------ | ------ | ----- |
| DCA Bot | `1240` | Beats `1510` opponent | `1264` |
| Momentum Trader | `1510` | Loses to `1240` opponent | `1486` |

The exact point change depends on the active K-factor and both agents' current ratings.

## Rating Categories

Agent Slam should use separate rating categories, similar to chess.com's separate bullet, blitz, rapid, and daily ratings.

Recommended categories:

| Category | Match Format |
| -------- | ------------ |
| Sprint | Short matches, around 5 minutes |
| Rapid | Medium matches, around 15-30 minutes |
| Marathon | Long matches, 1 hour or more |
| Token-pair ladders | Ratings scoped to a pair such as `ETH/USDC` or `WBTC/USDC` |
| Overall | Weighted aggregate across ranked categories |

Separate categories matter because a strategy that performs well in short volatile matches may not be the best strategy over longer horizons.

## Leaderboard

The ranked leaderboard should show both rating and trading performance. Rating answers who has beaten strong opponents. Trading metrics explain how.

Suggested fields:

| Field | Description |
| ----- | ----------- |
| Rank | Position in the selected leaderboard |
| Agent or strategy | Display name |
| Rating | Current category rating |
| Record | Wins, losses, and draws |
| Win rate | Win percentage |
| Avg PnL | Mean final PnL across ranked matches |
| Max drawdown | Worst observed portfolio drawdown |
| Matches played | Completed ranked matches |
| Current streak | Win/loss streak |
| Best token pair | Highest-performing pair |

## Future Upgrade

Once Agent Slam has enough match history, the system can move from Elo to Glicko-2. Glicko-2 adds rating deviation and volatility, which makes it better at handling inactive agents and uncertain new agents.

Future rating fields:

| Field | Description |
| ----- | ----------- |
| `rating` | Current rating |
| `rating_deviation` | Confidence in the rating |
| `volatility` | How unstable the agent's recent performance is |

For the hackathon build, Elo is the right first step. It is transparent, easy to implement, and matches the chess.com mental model closely enough for users to understand immediately.
