# Technical Spec

This document condenses the original Agent Slam technical draft into the core implementation contracts for the hackathon build.

## System Components

| Component | Responsibility |
| --------- | -------------- |
| Agent Slam UI | Match setup, live leaderboard, decision feed, trade history |
| Referee agent | Match orchestration, fairness, PnL tracking, winner declaration |
| Contender agents | Strategy evaluation and trade execution |
| AXL mesh | Agent communication |
| Uniswap API | Quotes, swap construction, and market-derived prices |
| KeeperHub | Transaction submission and retry handling |

## Project Structure

```bash
agent_slam/
+-- __init__.py
+-- agents/
|   +-- referee/
|   +-- contenders/
+-- shared/
|   +-- __init__.py
|   +-- axl/
|   |   +-- __init__.py
|   |   +-- node.py
|   |   +-- gossip.py
|   +-- agents/
|   |   +-- __init__.py
|   |   +-- base.py
|   +-- integrations/
|   |   +-- __init__.py
|   |   +-- uniswap.py
|   |   +-- keeperhub.py
|   +-- config.py
|   +-- constants.py
|   +-- errors.py
|   +-- nonce.py
|   +-- logger.py
|   +-- types.py
```

## Internal Shared Module

The shared module contains Agent Slam's internal building blocks: agent base classes, AXL helpers, integration clients, constants, errors, and wallet utilities. It is shared across this project only.

The goal is to keep Referee and Contender implementations small while avoiding premature framework code. Anything in this module should be needed by at least two Agent Slam components or represent a stable external integration boundary.

### AXL Node Wrapper

The AXL wrapper hides direct HTTP calls behind a small async interface. It is intentionally thin: Agent Slam components own match semantics, while this client owns process startup, direct peer sends, and message polling.

```python
import asyncio
import json
import subprocess
from datetime import datetime, timezone

import httpx


class AXLNode:
    def __init__(
        self,
        node_id: str,
        port: int,
        bootstrap_peers: list[str] | None = None,
    ):
        self.node_id = node_id
        self.port = port
        self.bootstrap_peers = bootstrap_peers or []
        self.base_url = f"http://127.0.0.1:{port}"
        self.process = None
        self.client = httpx.AsyncClient(timeout=30.0)
        self._recv_task = None
        self._handlers: dict[str, callable] = {}

    async def start(self):
        cmd = ["axl", "start", "--node-id", self.node_id, "--port", str(self.port)]
        for peer in self.bootstrap_peers:
            cmd.extend(["--bootstrap", peer])

        self.process = subprocess.Popen(cmd)
        await asyncio.sleep(2)
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def send(self, peer_id: str, message: dict):
        await self.client.post(
            f"{self.base_url}/send",
            headers={"X-Destination-Peer-Id": peer_id},
            content=json.dumps(message).encode(),
        )

    async def _recv_loop(self):
        while self.process and self.process.poll() is None:
            try:
                resp = await self.client.get(f"{self.base_url}/recv")
                if resp.status_code == 200 and resp.content:
                    message = json.loads(resp.content)
                    handler = self._handlers.get(message.get("type", ""))
                    if handler:
                        await handler(message.get("sender", ""), message)
            except (httpx.TimeoutException, httpx.ConnectError):
                await asyncio.sleep(1)
            except json.JSONDecodeError:
                continue

    def on_message(self, msg_type: str, handler: callable):
        self._handlers[msg_type] = handler
```

### GossipSub

Agent Slam models the arena feed as application-level gossip over direct AXL peer messages. A lightweight broadcast helper is enough for the hackathon build.

```python
class GossipSub:
    def __init__(self, axl: AXLNode, known_peers: list[str]):
        self.axl = axl
        self.known_peers = known_peers

    async def broadcast(self, message: dict):
        message["broadcasted_at"] = datetime.now(timezone.utc).isoformat()
        for peer_id in self.known_peers:
            await self.axl.send(peer_id, message)
```

### Base Agent

`BaseAgent` is the minimal lifecycle contract shared by the Referee and Contenders.

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class AgentIdentity:
    name: str
    role: str
    personality: str
    axl_node_id: str
    description: str


class BaseAgent(ABC):
    def __init__(self, identity: AgentIdentity, axl_node: AXLNode, gossip: GossipSub):
        self.identity = identity
        self.axl = axl_node
        self.gossip = gossip
        self.running = False

    @abstractmethod
    async def on_start(self): ...

    @abstractmethod
    async def on_message(self, sender: str, message: dict): ...

    async def broadcast(self, message: dict):
        await self.gossip.broadcast(message)

    async def send_direct(self, peer_id: str, message: dict):
        await self.axl.send(peer_id, message)
```

### Uniswap Trading Client

The Uniswap client is the shared market and swap boundary. Strategies should use this client rather than calling the Trading API directly.

```python
import httpx


class UniswapTradingClient:
    def __init__(self, api_key: str, chain_id: int = 1):
        self.api_key = api_key
        self.chain_id = chain_id
        self.base_url = "https://trade-api.gateway.uniswap.org/v1"
        self.client = httpx.AsyncClient(
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def get_quote(
        self,
        token_in: str,
        token_out: str,
        amount: str,
        swapper: str,
        slippage_tolerance: float = 0.5,
    ) -> dict:
        body = {
            "type": "EXACT_INPUT",
            "amount": amount,
            "tokenIn": token_in,
            "tokenOut": token_out,
            "tokenInChainId": self.chain_id,
            "tokenOutChainId": self.chain_id,
            "swapper": swapper,
            "slippageTolerance": slippage_tolerance,
        }
        resp = await self.client.post(f"{self.base_url}/quote", json=body)
        resp.raise_for_status()
        return resp.json()

    async def build_swap(self, quote: dict) -> dict:
        resp = await self.client.post(f"{self.base_url}/swap", json={"quote": quote})
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        await self.client.aclose()
```

### Token Constants

```python
KNOWN_TOKENS = {
    "ETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "DAI": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "WBTC": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "UNI": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
}

TOKEN_DECIMALS = {
    "USDC": 6,
    "USDT": 6,
    "DAI": 18,
    "WETH": 18,
    "ETH": 18,
    "WBTC": 8,
    "UNI": 18,
}
```

### Error Codes

| Range | Category |
| ----- | -------- |
| `E1xxx` | Validation errors |
| `E2xxx` | Agent lifecycle errors |
| `E3xxx` | Uniswap API errors |
| `E4xxx` | Execution errors |
| `E5xxx` | KeeperHub errors |
| `E6xxx` | AXL errors |
| `E7xxx` | External agent interface errors |

```python
from enum import Enum


class ErrorCode(str, Enum):
    VALIDATION_INVALID_TOKEN = "E1001"
    VALIDATION_INVALID_AMOUNT = "E1002"
    AGENT_UNAVAILABLE = "E2001"
    AGENT_TIMEOUT = "E2002"
    UNISWAP_QUOTE_FAILED = "E3001"
    UNISWAP_SWAP_BUILD_FAILED = "E3002"
    EXECUTION_FAILED = "E4001"
    EXECUTION_REVERTED = "E4002"
    KEEPERHUB_SUBMIT_FAILED = "E5001"
    AXL_DISCONNECTED = "E6001"
    AXL_PEER_UNREACHABLE = "E6002"
    A2A_INVALID_REQUEST = "E7001"


class AgentSlamError(Exception):
    def __init__(self, code: ErrorCode, message: str, details: dict | None = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"[{code.value}] {message}")

    def to_dict(self) -> dict:
        return {
            "error_code": self.code.value,
            "message": self.message,
            "details": self.details,
        }
```

### Nonce Manager

```python
import asyncio


class NonceManager:
    def __init__(self, rpc_url: str, wallet_address: str):
        self.rpc_url = rpc_url
        self.wallet_address = wallet_address
        self._pending_nonce = None
        self._lock = asyncio.Lock()

    async def get_next_nonce(self) -> int:
        async with self._lock:
            if self._pending_nonce is None:
                from web3 import Web3

                web3 = Web3(Web3.HTTPProvider(self.rpc_url))
                self._pending_nonce = web3.eth.get_transaction_count(
                    self.wallet_address,
                    "pending",
                )
            else:
                self._pending_nonce += 1

            return self._pending_nonce

    def reset(self):
        self._pending_nonce = None
```

## Match Configuration

```python
from dataclasses import dataclass


@dataclass
class MatchConfig:
    strategy_a: str = "dca"
    strategy_b: str = "momentum"
    token_pair: list[str] | None = None
    starting_capital: float = 1000.0
    duration_type: str = "time"
    duration_seconds: float = 300.0
    duration_blocks: int | None = None
    allow_taunts: bool = True
    tick_interval_seconds: float = 10.0
```

## Match Lifecycle

The hackathon build should treat a match as a simple repeated evaluation loop coordinated by the Referee.

1. The user selects two strategies, a token pair, starting capital, and match duration.
2. The Referee creates the match and initializes both Contenders with identical starting state.
3. The Referee begins the match timer and starts broadcasting market updates on each tick.
4. On every tick, each Contender evaluates the latest market state and emits a `buy`, `sell`, or `hold` decision with reasoning.
5. If a Contender decides to trade, it requests a quote, builds the swap, and submits execution through KeeperHub.
6. The Referee records decisions, trade reports, portfolio balances, gas cost, and running PnL.
7. When the timer expires or the match is stopped, the Referee computes final portfolio value and declares the result.

Implementation notes:

- The Referee is the source of match timing and final result calculation.
- Contenders operate independently and do not coordinate with each other.
- Market history needed by strategies should be derived from observed ticks and stored by the application.
- The first release should optimize for reliability and observability over market complexity.

## Strategy Interface

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum


class ActionType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


@dataclass
class StrategySignal:
    action: ActionType
    amount: float
    reasoning: str
    confidence: float
    strategy_name: str
    metadata: dict | None = None


class Strategy(ABC):
    @abstractmethod
    async def evaluate(self, portfolio, market) -> StrategySignal:
        ...

    @abstractmethod
    def describe(self) -> str:
        ...
```

## Portfolio Model

```python
from dataclasses import dataclass


@dataclass
class Portfolio:
    usdc_balance: float
    eth_balance: float
    trade_count: int = 0
    total_gas_spent_usd: float = 0.0

    def can_buy(self, amount_usd: float) -> bool:
        return self.usdc_balance >= amount_usd

    def can_sell(self, amount_eth: float) -> bool:
        return self.eth_balance >= amount_eth
```

## Match Data Models

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Trade:
    action: str
    token_sold: str
    amount_sold: float
    token_bought: str
    amount_bought: float
    tx_hash: str
    gas_cost_usd: float
    strategy_reasoning: str
    timestamp: datetime


@dataclass
class MatchResult:
    match_id: str
    winner: str
    contender_a_final: dict
    contender_b_final: dict


@dataclass
class Match:
    id: str
    config: MatchConfig
    status: str
    contender_a: Optional[object] = None
    contender_b: Optional[object] = None
    pnl_tracker: Optional[object] = None
    result: Optional[MatchResult] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
```

## Message Envelope

```json
{
  "envelope": {
    "version": "1.0",
    "message_id": "msg_uuid",
    "timestamp": "2026-04-24T15:30:00Z",
    "from": {
      "agent": "Momentum Rider",
      "axl_node_id": "agent-slam-contender-b"
    },
    "to": {
      "agent": "Referee",
      "axl_node_id": "agent-slam-referee-001"
    },
    "type": "trade_report"
  },
  "payload": {}
}
```

## Message Types

| Type | Direction | Description |
| ---- | --------- | ----------- |
| `match_announcement` | Referee to arena | New match created |
| `match_started` | Referee to arena | Match begins |
| `match_ended` | Referee to arena | Match concluded |
| `decision` | Contender to arena | Strategy decision |
| `trade_report` | Contender to Referee | Trade execution result |
| `leaderboard_update` | Referee to arena | PnL update |
| `taunt` | Contender to arena | Optional banter |
| `heartbeat` | Any agent to arena | Health check |
| `rule_violation` | Referee to Contender | Rule warning |

## WebSocket Events

Leaderboard update:

```json
{
  "event": "leaderboard_update",
  "match_id": "match_abc123",
  "eth_price": 3412.0,
  "contenders": {
    "A": {
      "name": "DCA Bot",
      "pnl_pct": 1.2,
      "portfolio_usd": 1012.0,
      "trades": 3
    },
    "B": {
      "name": "Momentum Rider",
      "pnl_pct": 3.7,
      "portfolio_usd": 1037.0,
      "trades": 5
    }
  },
  "time_remaining_seconds": 126
}
```

Decision event:

```json
{
  "event": "decision",
  "contender": "Momentum Rider",
  "action": "buy",
  "amount": 150.0,
  "reasoning": "ETH up 1.2% - bullish trend detected",
  "confidence": 0.72
}
```

Trade event:

```json
{
  "event": "trade_executed",
  "contender": "Momentum Rider",
  "tx_hash": "0xdef456...",
  "sold": {
    "token": "USDC",
    "amount": 150.0
  },
  "bought": {
    "token": "ETH",
    "amount": 0.044
  },
  "gas_usd": 1.23
}
```

## API Endpoints

| Method | Path | Response |
| ------ | ---- | -------- |
| `POST` | `/api/matches` | Created `Match` |
| `GET` | `/api/matches/{id}` | Current match state |
| `GET` | `/api/matches/{id}/trades` | `list[Trade]` |
| `GET` | `/api/matches/{id}/feed` | Decision events |
| `POST` | `/api/matches/{id}/stop` | Stopped match state |
| `GET` | `/api/strategies` | Available strategies |
| `GET` | `/api/leaderboard` | Historical match results |

## Environment

```bash
AGENT_SLAM_ENV=demo
AGENT_SLAM_LOG_LEVEL=INFO

AXL_BIN_PATH=axl
AGENT_SLAM_AXL_NETWORK=agent-slam

UNISWAP_API_KEY=
UNISWAP_CHAIN_ID=1
UNISWAP_API_BASE_URL=https://trade-api.gateway.uniswap.org/v1

KEEPERHUB_API_KEY=
KEEPERHUB_MCP_ENDPOINT=https://api.keeperhub.com/mcp
KEEPERHUB_CLI_PATH=keeperhub

EXECUTION_WALLET_PRIVATE_KEY_A=
EXECUTION_WALLET_PRIVATE_KEY_B=
WALLET_ADDRESS_A=
WALLET_ADDRESS_B=

REFEREE_AXL_PORT=8001
CONTENDER_A_AXL_PORT=8002
CONTENDER_B_AXL_PORT=8003

DEFAULT_STARTING_CAPITAL=1000
DEFAULT_DURATION_SECONDS=300
DEFAULT_TICK_INTERVAL=10
DEFAULT_STRATEGY_A=dca
DEFAULT_STRATEGY_B=momentum
```

## Resilience Rules

| Failure | Handling |
| ------- | -------- |
| Trade execution fails | KeeperHub retries with bounded gas boost |
| AXL node disconnects | Reconnect with backoff |
| Uniswap API timeout | Retry, then hold position |
| Contender crashes | Referee detects missing heartbeat |
| Both Contenders crash | Match declared void |
| Price unavailable | Use last known price and halt new trades |
| Match timeout | End at scheduled time |
