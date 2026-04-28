from enum import Enum
from dataclasses import dataclass


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


@dataclass
class TickContext:
    token_pair: str
    eth_price: float
    price_history: list[float]
    usdc_balance: float
    eth_balance: float
    portfolio_usd: float
    pnl_pct: float
    trade_count: int
    tick_number: int
    ticks_remaining: int
    # Sent by backend (MIN_TRADE_USD / per-contender max trade). Defaults match legacy $10-style floors if omitted.
    min_trade_usd: float = 10.0
    max_trade_usd: float = 1_000_000.0


@dataclass
class MatchInfo:
    match_id: str
    token_pair: str
    starting_capital_usd: float
    contender_side: str
