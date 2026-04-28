/**
 * Central place for per-trade sizing vs contender bankroll and global caps (MIN_TRADE_USD / MAX_TRADE_USD_ABSOLUTE).
 */

const DEFAULT_PCT_OF_CAPITAL = 0.5;

export interface TradingClampOptions {
  /** Fraction of starting bankroll allowed per trade (default 0.5). */
  pctOfCapital?: number;
  /** Upper bound from env; use `Infinity` when unset. */
  maxTradeUsdAbsolute: number;
}

/**
 * Max USD notional for one trade: min(pct * startingCapital, absoluteCap).
 */
export function clampMaxTradeUsd(contenderStartingCapitalUsd: number, options: TradingClampOptions): number {
  const pct = options.pctOfCapital ?? DEFAULT_PCT_OF_CAPITAL;
  const pctCap = contenderStartingCapitalUsd * pct;
  return Math.min(pctCap, options.maxTradeUsdAbsolute);
}

export function pnlPctFromPortfolio(portfolioUsd: number, startingCapitalUsd: number): number {
  if (startingCapitalUsd <= 0) return 0;
  return Number(((portfolioUsd / startingCapitalUsd - 1) * 100).toFixed(2));
}
