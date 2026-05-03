# Local Live Demo Runbook

Use this when a new reviewer wants to run Agent Slam locally with the full demo stack: frontend, backend, PostgreSQL, Python agents, live Sepolia Uniswap swaps, KeeperHub execution, and 0G memory proof mode.

## One Command

```bash
./scripts/start-live-demo.sh
```

If the KeeperHub wallet does not already have enough USDC allowance, run:

```bash
./scripts/start-live-demo.sh --approve
```

The script starts:

- Backend: `http://localhost:8787`
- Frontend: `http://localhost:3000`
- PostgreSQL via `backend/docker-compose.yml`

Stop local servers:

```bash
./scripts/stop-live-demo.sh
```

## Required `backend/.env` Values

The script copies `backend/.env.example` if `backend/.env` does not exist, but it cannot invent secrets. Fill these first:

```env
UNISWAP_API_KEY=...
KEEPERHUB_API_KEY=...

# Required for 0G proof mode. Use --no-zerog if you only want KeeperHub.
ZEROG_PRIVATE_KEY=...
ZEROG_KV_STREAM_ID=...
ZEROG_EVM_RPC=https://evmrpc-testnet.0g.ai
ZEROG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_KV_RPC=http://178.238.236.119:6789
```

The script automatically applies safe Sepolia live-demo settings:

```env
UNISWAP_CHAIN_ID=11155111
UNISWAP_SWAP_MODE=live
UNISWAP_PERMIT2_DISABLED=true
UNISWAP_SWAPPER_ADDRESS=<KeeperHub wallet from /user>
WALLET_PRIVATE_KEY=
MIN_TRADE_USD=0.1
MAX_TRADE_USD_ABSOLUTE=0.1
DEFAULT_PER_AGENT_STARTING_CAPITAL_USD=1
AGENTS_PYTHON_PATH=<repo>/agents/.venv/bin/python
AGENTS_PACKAGE_DIR=<repo>/agents
```

It backs up the previous backend env as `backend/.env.live-demo.bak.<timestamp>`.

## KeeperHub Wallet Requirements

The script reads the KeeperHub execution wallet from `GET /user` using `KEEPERHUB_API_KEY`.

For a clean `$0.10` Sepolia canary, that wallet needs:

- Sepolia ETH for gas
- Sepolia USDC for input token
- USDC allowance to the Uniswap Sepolia proxy spender

The default approval amount is `1 USDC`. Override it if needed:

```bash
DEMO_ALLOWANCE_USDC=2 ./scripts/start-live-demo.sh --approve
```

## How To Demo In The UI

1. Open `http://localhost:3000`.
2. Go to **Strategies** and click **Run Simulation**, or open **Matches**.
3. In **Start Hackathon Match**, use:
   - Agent A: create new `DCA Bot`
   - Agent B: create new `Momentum Trader` or `Random Walk`
   - Pair: `WETH/USDC`
   - Capital: `1`
   - Seconds: `30`
4. Click **Start**.
5. In the arena, inspect:
   - live decision feed
   - trade tape
   - Uniswap proof panel
   - KeeperHub audit panel
   - 0G memory panel
6. Open `http://localhost:3000/keeperhub` to show the dedicated execution audit dashboard.

For the cleanest KeeperHub proof, stop the match after the first `uniswap_live_swap` trade completes. Sepolia liquidity can intermittently return `No quotes available`; the backend intentionally falls back to paper trades so the arena remains stable.

## Amounts For A Visible Demo

There are two separate amounts:

- **Match capital** in the UI controls portfolio/PnL scale. Use `1` for safe live Sepolia, or `100` for a more visible stable arena run.
- **Live execution cap** is controlled by `DEMO_TRADE_USD` / `MAX_TRADE_USD_ABSOLUTE`. Default is `0.1` USDC for safety.

For judging, keep live KeeperHub proof at `0.1` USDC unless the wallet has more allowance and test USDC:

```bash
DEMO_TRADE_USD=0.5 DEMO_ALLOWANCE_USDC=2 ./scripts/start-live-demo.sh --approve
```

Higher live amounts make the KeeperHub proof more visible, but they also spend more Sepolia USDC and gas. For a dramatic PnL difference between agents, use a stable arena run with higher capital, then show a separate small live KeeperHub execution proof.
