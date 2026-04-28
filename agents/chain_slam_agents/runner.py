import json
import sys
import asyncio
import argparse

import websockets

from .types import TickContext, ActionType
from .strategies import STRATEGIES


async def run(agent_id: str, strategy_id: str, ws_url: str) -> None:
    strategy_cls = STRATEGIES.get(strategy_id)
    if strategy_cls is None:
        print(f"Unknown strategy: {strategy_id}", file=sys.stderr)
        sys.exit(1)

    strategy = strategy_cls()
    print(f"[{agent_id}] connecting to {ws_url} with strategy={strategy.describe()}")

    async with websockets.connect(ws_url) as ws:
        async for raw in ws:
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "tick":
                ctx = TickContext(
                    token_pair=msg["tokenPair"],
                    eth_price=msg["ethPrice"],
                    price_history=msg.get("priceHistory", []),
                    usdc_balance=msg["usdcBalance"],
                    eth_balance=msg["ethBalance"],
                    portfolio_usd=msg["portfolioUsd"],
                    pnl_pct=msg["pnlPct"],
                    trade_count=msg.get("tradeCount", 0),
                    tick_number=msg["tickNumber"],
                    ticks_remaining=msg.get("ticksRemaining", 0),
                    min_trade_usd=float(msg.get("minTradeUsd", 10)),
                    max_trade_usd=float(msg.get("maxTradeUsd", 1_000_000)),
                )
                signal = strategy.evaluate(ctx)
                response = {
                    "type": "decision",
                    "action": signal.action.value,
                    "amount": signal.amount,
                    "reasoning": signal.reasoning,
                    "confidence": signal.confidence,
                }
                await ws.send(json.dumps(response))

            elif msg_type == "match_end":
                print(f"[{agent_id}] match ended: {msg.get('reason', 'unknown')}")
                break

    print(f"[{agent_id}] runner exiting")


def main() -> None:
    parser = argparse.ArgumentParser(description="Chain Slam agent runner")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--ws-url", required=True)
    args = parser.parse_args()

    asyncio.run(run(args.agent_id, args.strategy, args.ws_url))


if __name__ == "__main__":
    main()
