# Chain Slam Agent Handoff

## Project Context

Chain Slam is an ETHGlobal Open Agents hackathon project. It is an AI-vs-AI DeFi trading arena: two agents start with the same capital, trade the same token pair, explain their decisions, and compete on final portfolio value.

Target partner prizes:

- Uniswap: quote, approval, swap construction, and market access.
- KeeperHub: reliable onchain execution, status tracking, and execution audit trails.
- 0G: autonomous agent/swarm and onchain-AI narrative.

## Product Model

- Referee agent: creates matches, enforces fairness, tracks PnL, streams events, declares winner.
- Contender agents: each owns one strategy and emits `buy`, `sell`, or `hold` decisions.
- UI/API: exposes setup, decision feed, trade history, leaderboard, and websocket match events.

The core demo should show: agent decision -> Uniswap quote/swap -> KeeperHub execution -> tx/status/audit trail -> PnL update.

## Current Backend

- Stack: Fastify + TypeScript in `backend/`.
- Modes:
  - `BACKEND_MODE=dummy`: deterministic simulated matches, no external credentials.
  - `BACKEND_MODE=real`: LLM strategy runtime, Uniswap price reads, optional KeeperHub-backed execution.
- Current important files:
  - `backend/src/services/real-match-service.ts`: match orchestration and Referee loop.
  - `backend/src/services/execution-service.ts`: Uniswap + KeeperHub trade execution coordinator.
  - `backend/src/integrations/uniswap.ts`: Uniswap API client.
  - `backend/src/integrations/keeperhub.ts`: KeeperHub Direct Execution API client.
  - `backend/src/types.ts`: public event and API payload types.

## KeeperHub Implementation Rules

- Do not generate fake tx hashes when `KEEPERHUB_ENABLED=true`.
- Portfolio balances are mutated only after successful execution.
- Execution failures must be recorded as `trade_failed` events and must not stop the match.
- Keep external API response parsing isolated inside integration clients.
- Never log API keys, auth headers, private keys, or wallet secrets.
- Keep existing `txHash` on successful trades for frontend compatibility, but prefer `transactionHash` and `transactionLink` in new code.

## API/Event Contracts

Websocket events:

- `snapshot`
- `decision`
- `trade_submitted`
- `trade_executed`
- `trade_failed`
- `completed`
- `stopped`

Trade history endpoints:

- `GET /api/matches/:id/trades`
- `GET /api/matches/:id/executions`

Errors use:

```json
{
  "error": {
    "code": "MATCH_NOT_FOUND",
    "message": "Match not found",
    "requestId": "..."
  }
}
```

## Demo Defaults

- Chain: Sepolia.
- Match: Momentum Trader vs Mean Reverter.
- Pair: `WETH/USDC` or the closest available Sepolia test-token pair.
- Starting capital: `1000 USDC`.
- Duration: 5 minutes.

If Uniswap Sepolia liquidity blocks a live swap, keep KeeperHub visible by executing a documented contract call such as ERC-20 approval/transfer and clearly mark the swap as fallback in the demo.

## Commands

Run from `backend/`:

```bash
npm install
npm run build
npm run test:smoke
npm run dev
```

Real-mode env checklist:

```bash
BACKEND_MODE=real
UNISWAP_ENABLED=true
UNISWAP_API_KEY=...
UNISWAP_CHAIN_ID=11155111
KEEPERHUB_ENABLED=true
KEEPERHUB_API_KEY=...
KEEPERHUB_NETWORK=sepolia
```

## Open Risks

- KeeperHub Direct Execution currently documents contract-call execution, not arbitrary raw calldata execution. The code records a clear `UNISWAP_SWAP_UNSUPPORTED` failure if Uniswap swap data cannot be represented as a KeeperHub contract call.
- Uniswap testnet liquidity and token support should be verified before the final demo.
- MCP/CLI are useful for sponsor storytelling, but the backend integration path is REST Direct Execution.
