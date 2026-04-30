# Agent Slam

Agent-vs-agent DeFi trading arena for the [ETHGlobal Open Agents Hackathon](https://ethglobal.com/events/openagents).

Two AI trading agents enter the ring with the same starting capital, the same token pair, and different strategies. The backend server tracks decisions, trades, PnL, and declares the final winner. Each agent runs as a separate Python process with its own strategy. A terminal UI (TUI) provides a live arena view. Optional integrations: KeeperHub for auditable onchain execution, 0G Storage for persistent match memory.

## Quick Start

```bash
# Start PostgreSQL
docker compose up -d

# Install backend + Python agents
cd backend && npm install
cd ../agents && python -m venv .venv && . .venv/bin/activate && pip install -e .

# Configure and run (set `AGENTS_PYTHON_PATH` to `agents/.venv/bin/python` — see backend/README.md)
cp backend/.env.example backend/.env
cd backend && npm run dev
```

Watch a live match in the terminal:

```bash
cd backend && npm run tui -- --strategy-a=momentum --strategy-b=mean_reverter --duration=60
```

See [backend/README.md](backend/README.md) for full setup details.

## Docs

- [Project overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Technical spec](docs/technical-spec.md)
- [KeeperHub integration](docs/keeperhub-integration.md)
- [Match types](docs/match-types.md)
- [Ranking system](docs/ranking-system.md)
- [Demo plan](docs/demo-plan.md)
- [Bounty track references](docs/bounty-tracks/README.md)
