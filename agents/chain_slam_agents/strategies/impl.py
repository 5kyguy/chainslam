from ..base import Strategy
from ..types import TickContext, StrategySignal, ActionType


class DCAStrategy(Strategy):
    def __init__(self, buy_amount_usd: float = 100.0, interval: int = 1):
        self.buy_amount = buy_amount_usd
        self.interval = interval

    def evaluate(self, ctx: TickContext) -> StrategySignal:
        if ctx.tick_number % self.interval != 0:
            return StrategySignal(ActionType.HOLD, 0, "Waiting for next DCA interval.", 0.8)

        amount = min(self.buy_amount, ctx.usdc_balance * 0.3, ctx.max_trade_usd)
        if amount < ctx.min_trade_usd:
            return StrategySignal(ActionType.HOLD, 0, "Insufficient USDC for DCA buy.", 0.3)

        return StrategySignal(
            ActionType.BUY,
            amount,
            f"DCA: buying ${amount:.2f} at tick {ctx.tick_number}. Accumulating regardless of price.",
            0.85,
        )

    def describe(self) -> str:
        return f"DCA Bot (${self.buy_amount} every {self.interval} tick(s))"


class MomentumStrategy(Strategy):
    def evaluate(self, ctx: TickContext) -> StrategySignal:
        if len(ctx.price_history) < 3:
            return StrategySignal(ActionType.HOLD, 0, "Not enough price history to detect trend.", 0.3)

        recent = ctx.price_history[-3:]
        pct_change = (recent[-1] - recent[0]) / recent[0] * 100

        if pct_change > 0.3:
            strength = min(pct_change / 2, 1.0)
            amount = min(ctx.usdc_balance * 0.4 * strength, ctx.usdc_balance * 0.5, ctx.max_trade_usd)
            if amount < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Position too small.", 0.3)
            return StrategySignal(
                ActionType.BUY, amount,
                f"Momentum: price up {pct_change:.2f}% in recent window. Trend continuation expected.",
                min(0.5 + strength * 0.4, 0.95),
            )

        if pct_change < -0.3:
            strength = min(abs(pct_change) / 2, 1.0)
            sell_value = ctx.eth_balance * ctx.eth_price * 0.4 * strength
            if sell_value < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Position too small to sell.", 0.3)
            sell_eth = ctx.eth_balance * 0.4 * strength
            return StrategySignal(
                ActionType.SELL, sell_eth,
                f"Momentum: price down {pct_change:.2f}%. Reducing exposure.",
                min(0.5 + strength * 0.4, 0.95),
            )

        return StrategySignal(ActionType.HOLD, 0, "No clear trend. Waiting for momentum signal.", 0.5)

    def describe(self) -> str:
        return "Momentum Trader"


class MeanReverterStrategy(Strategy):
    def __init__(self, window: int = 10, threshold_pct: float = 1.0):
        self.window = window
        self.threshold = threshold_pct

    def evaluate(self, ctx: TickContext) -> StrategySignal:
        if len(ctx.price_history) < self.window:
            return StrategySignal(ActionType.HOLD, 0, "Building price history for mean calculation.", 0.3)

        window_prices = ctx.price_history[-self.window:]
        mean_price = sum(window_prices) / len(window_prices)
        deviation_pct = (ctx.eth_price - mean_price) / mean_price * 100

        if deviation_pct < -self.threshold:
            strength = min(abs(deviation_pct) / (self.threshold * 2), 1.0)
            amount = min(ctx.usdc_balance * 0.4 * strength, ctx.usdc_balance * 0.5, ctx.max_trade_usd)
            if amount < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Undersized buy.", 0.3)
            return StrategySignal(
                ActionType.BUY, amount,
                f"Mean reversion: price {deviation_pct:.2f}% below {self.window}-tick mean. Expecting bounce.",
                0.7 + strength * 0.2,
            )

        if deviation_pct > self.threshold:
            strength = min(deviation_pct / (self.threshold * 2), 1.0)
            sell_eth = ctx.eth_balance * 0.4 * strength
            if sell_eth * ctx.eth_price < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Undersized sell.", 0.3)
            return StrategySignal(
                ActionType.SELL, sell_eth,
                f"Mean reversion: price {deviation_pct:.2f}% above {self.window}-tick mean. Expecting pullback.",
                0.7 + strength * 0.2,
            )

        return StrategySignal(ActionType.HOLD, 0, f"Price near mean ({deviation_pct:.2f}% deviation). Waiting.", 0.4)

    def describe(self) -> str:
        return f"Mean Reverter ({self.window}-tick window)"


class FearGreedStrategy(Strategy):
    def evaluate(self, ctx: TickContext) -> StrategySignal:
        if len(ctx.price_history) < 2:
            return StrategySignal(ActionType.HOLD, 0, "Not enough data.", 0.3)

        recent_change = (ctx.eth_price - ctx.price_history[-2]) / ctx.price_history[-2] * 100

        if recent_change < -1.0:
            fear = min(abs(recent_change) / 3, 1.0)
            amount = min(ctx.usdc_balance * 0.5 * fear, ctx.usdc_balance * 0.5, ctx.max_trade_usd)
            if amount < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Too small.", 0.3)
            return StrategySignal(
                ActionType.BUY, amount,
                f"Fear: price dropped {recent_change:.2f}%. Buying the dip — others are panicking.",
                0.6 + fear * 0.3,
            )

        if recent_change > 1.0:
            greed = min(recent_change / 3, 1.0)
            sell_eth = ctx.eth_balance * 0.5 * greed
            if sell_eth * ctx.eth_price < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Too small.", 0.3)
            return StrategySignal(
                ActionType.SELL, sell_eth,
                f"Greed: price spiked {recent_change:.2f}%. Taking profits while others are euphoric.",
                0.6 + greed * 0.3,
            )

        return StrategySignal(ActionType.HOLD, 0, "Market calm. No fear or greed trigger.", 0.4)

    def describe(self) -> str:
        return "Fear & Greed"


class GridStrategy(Strategy):
    def __init__(self, grid_pct: float = 1.5, levels: int = 4):
        self.grid_pct = grid_pct
        self.levels = levels
        self.center_price: float | None = None
        self.trades_at_levels: set[int] = set()

    def evaluate(self, ctx: TickContext) -> StrategySignal:
        if self.center_price is None:
            self.center_price = ctx.eth_price

        grid_spacing = self.center_price * (self.grid_pct / 100)

        level = round((ctx.eth_price - self.center_price) / grid_spacing)
        level = max(-self.levels, min(self.levels, level))

        if level < 0 and level not in self.trades_at_levels:
            amount = min(ctx.usdc_balance * 0.2, ctx.usdc_balance * 0.5, ctx.max_trade_usd)
            if amount < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Undersized grid buy.", 0.3)
            self.trades_at_levels.add(level)
            return StrategySignal(
                ActionType.BUY, amount,
                f"Grid buy at level {level} (price ${ctx.eth_price:.2f}, center ${self.center_price:.2f}).",
                0.75,
            )

        if level > 0 and -level not in self.trades_at_levels:
            return StrategySignal(ActionType.HOLD, 0, "Waiting for symmetric grid fill.", 0.4)

        if level > 0 and -level in self.trades_at_levels:
            sell_eth = ctx.eth_balance * 0.2
            if sell_eth * ctx.eth_price < ctx.min_trade_usd:
                return StrategySignal(ActionType.HOLD, 0, "Undersized grid sell.", 0.3)
            self.trades_at_levels.discard(-level)
            return StrategySignal(
                ActionType.SELL, sell_eth,
                f"Grid sell at level {level} (price ${ctx.eth_price:.2f}). Closing grid position.",
                0.75,
            )

        return StrategySignal(ActionType.HOLD, 0, f"Price at grid center. No level triggered.", 0.4)

    def describe(self) -> str:
        return f"Grid Trader ({self.grid_pct}% spacing)"


class RandomStrategy(Strategy):
    def __init__(self, seed: int | None = None):
        self.rng = __import__("random").Random(seed)

    def evaluate(self, ctx: TickContext) -> StrategySignal:
        roll = self.rng.random()
        mn = ctx.min_trade_usd
        mx = ctx.max_trade_usd

        # Buy branch: sized between server min/max trade (works with $1 bankrolls; legacy code required >$10 USDC).
        if roll < 0.25 and ctx.usdc_balance > mn:
            low = mn
            high = min(mx, ctx.usdc_balance * 0.5)
            if high <= low + 1e-12:
                return StrategySignal(ActionType.HOLD, 0, self._random_reason("hold"), self.rng.uniform(0.3, 0.6))
            amount = self.rng.uniform(low, high)
            return StrategySignal(
                ActionType.BUY, amount,
                self._random_reason("buy"),
                self.rng.uniform(0.4, 0.8),
            )

        if roll > 0.75 and ctx.eth_balance * ctx.eth_price > mn:
            sell_eth = ctx.eth_balance * self.rng.uniform(0.1, 0.5)
            if sell_eth * ctx.eth_price < mn:
                return StrategySignal(ActionType.HOLD, 0, self._random_reason("hold"), 0.3)
            return StrategySignal(
                ActionType.SELL, sell_eth,
                self._random_reason("sell"),
                self.rng.uniform(0.4, 0.8),
            )

        return StrategySignal(ActionType.HOLD, 0, self._random_reason("hold"), self.rng.uniform(0.3, 0.6))

    def _random_reason(self, action: str) -> str:
        reasons = {
            "buy": [
                "Chart pattern looks vaguely bullish. Maybe.",
                "The vibes are good. Buying.",
                "Coin flip says buy. Trusting the process.",
                "Random number generator says go long.",
            ],
            "sell": [
                "Taking profits before the chart does something weird.",
                "Gut feeling says sell. The gut is random.",
                "Statistical noise suggests distribution. Selling.",
                "The dice said so. No further analysis.",
            ],
            "hold": [
                "No strong signal from the entropy source.",
                "Holding. The random walk continues.",
                "Waiting for more chaotic inspiration.",
                "Current position matches random expectation.",
            ],
        }
        return self.rng.choice(reasons.get(action, ["No comment."]))

    def describe(self) -> str:
        return "Random Walk (control baseline)"
