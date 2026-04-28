# Architecture

Chain Slam is organized around three live agent roles:

- Referee agent: orchestrates matches, enforces rules, tracks PnL, and declares winners.
- Contender A: trades according to one strategy.
- Contender B: trades according to another strategy.

Each agent runs as its own process with its own AXL node.

```bash
                          CHAIN SLAM UI
                 live leaderboard, feed, setup
                                  |
                              HTTP / WS
                                  |
                           REFEREE AGENT
                    rules, PnL, events, winner
                                  |
                              AXL mesh
                         arena message channel
                           /              \
                  CONTENDER A          CONTENDER B
                  strategy one         strategy two
                           \              /
                    Uniswap API + KeeperHub
                                  |
                         onchain execution
```

## Referee Agent

The Referee is the neutral orchestrator. It does not trade.

Responsibilities:

- Create and configure matches.
- Spawn or connect the two Contender agents.
- Broadcast match announcements and status updates.
- Monitor heartbeats and rule violations.
- Track portfolio balances, gas cost, trades, and PnL.
- Stream updates to the UI.
- Declare the winner when the match ends.

Core API surface:

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/matches` | Create a match |
| `GET` | `/api/matches/{match_id}` | Get match state |
| `GET` | `/api/matches/{match_id}/trades` | Get trade history |
| `GET` | `/api/matches/{match_id}/feed` | Get decision feed |
| `POST` | `/api/matches/{match_id}/stop` | Stop a match |
| `GET` | `/api/strategies` | List available strategies |
| `WS` | `/ws/matches/{match_id}` | Stream live match updates |

## Contender Agents

A Contender is a modular trading agent. It owns one strategy, a portfolio, and an execution wallet.

Core loop:

1. Poll or derive market data from Uniswap.
2. Evaluate the active strategy.
3. Broadcast the decision and reasoning.
4. If the signal is `buy` or `sell`, request a quote and build a swap.
5. Submit execution through KeeperHub.
6. Report the trade result to the Referee.

## AXL Mesh

AXL is the agent communication layer. The project models a logical arena channel on top of direct AXL peer messages.

Node topology:

| Agent | AXL Node ID | Port |
| ----- | ----------- | ---- |
| Referee | `chain-slam-referee-001` | `8001` |
| Contender A | `chain-slam-contender-a` | `8002` |
| Contender B | `chain-slam-contender-b` | `8003` |

AXL node IDs should be static. Match-specific context belongs in message payloads, not in node IDs.

Logical topics:

| Topic | Purpose |
| ----- | ------- |
| `chain-slam/arena` | Match events and agent decisions |
| `chain-slam/trade_reports` | Execution results from Contenders |
| `chain-slam/heartbeat` | Agent health checks |
| `chain-slam/taunts` | Optional inter-agent banter |

## Uniswap Integration

Uniswap is the market layer. Contenders use the Trading API for quotes, approval checks, and swap construction.

Important assumptions from the source spec:

- Trading API base URL: `https://trade-api.gateway.uniswap.org/v1`
- Trading API endpoints are `POST` endpoints.
- There is no price-history endpoint in the Trading API.
- Strategies that need history collect their own price samples over time.

Primary endpoints:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/quote` | Generate a swap quote |
| `POST` | `/swap` | Build an unsigned swap transaction |
| `POST` | `/check_approval` | Check token approval requirements |

## KeeperHub Integration

KeeperHub is the execution layer. Both Contenders use the same KeeperHub configuration so neither receives an execution advantage.

Expected capabilities:

- Submit transaction tasks.
- Check transaction status.
- Retry failed transactions with bounded gas boosting.
- Preserve an execution audit trail for each trade.

The backend integration uses KeeperHub Direct Execution over REST. Chain Slam treats KeeperHub as an external execution provider behind an internal `ExecutionService`: the Referee asks for a trade execution, the service builds the Uniswap quote/swap, submits compatible contract calls to KeeperHub, polls status, and returns either a completed trade or a failed execution event.

Execution events:

| Event | Meaning |
| ----- | ------- |
| `trade_submitted` | KeeperHub accepted an execution request |
| `trade_executed` | KeeperHub completed execution and returned transaction metadata |
| `trade_failed` | KeeperHub or Uniswap execution failed; portfolio balances were not mutated |

Important implementation constraint: KeeperHub Direct Execution currently documents contract-call execution. If a Uniswap swap response only provides raw calldata and cannot be represented as a KeeperHub contract call, the backend records a clear `UNISWAP_SWAP_UNSUPPORTED` failure instead of faking execution.

## Match Rules

| Rule | Description |
| ---- | ----------- |
| Equal capital | Both Contenders start with the same balances |
| Same market | Both agents trade the same token pair |
| Same execution | Both agents use the same KeeperHub configuration |
| Position limits | No single trade can use more than 50% of the portfolio |
| Minimum trade | Trades must be at least 10 USD equivalent |
| Bankruptcy protection | Agents stop trading below a configured portfolio floor |
| Transparent decisions | Every decision is broadcast before execution |
