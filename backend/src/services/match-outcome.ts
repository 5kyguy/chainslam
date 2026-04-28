import type { MatchState } from "../types.js";

/** If rounded PnL % difference is smaller than this, tie-break using final portfolio USD */
export const OUTCOME_RELATIVE_PNL_TOLERANCE_PCT = 0.25;
/** Portfolio values considered identical for a draw after PnL tie (half-cent vs 2dp rounding) */
export const OUTCOME_PORTFOLIO_USD_EPS = 0.005;

export interface MatchOutcome {
  resultA: "win" | "loss" | "draw";
  resultB: "win" | "loss" | "draw";
}

export function computeMatchOutcome(match: MatchState): MatchOutcome {
  const pnlA = match.contenders.A.pnlPct;
  const pnlB = match.contenders.B.pnlPct;
  const portfolioA = match.contenders.A.portfolioUsd;
  const portfolioB = match.contenders.B.portfolioUsd;

  let resultA: "win" | "loss" | "draw";
  let resultB: "win" | "loss" | "draw";

  const pnlGap = Math.abs(pnlA - pnlB);
  if (pnlGap >= OUTCOME_RELATIVE_PNL_TOLERANCE_PCT) {
    if (pnlA > pnlB) {
      resultA = "win";
      resultB = "loss";
    } else {
      resultA = "loss";
      resultB = "win";
    }
  } else if (Math.abs(portfolioA - portfolioB) <= OUTCOME_PORTFOLIO_USD_EPS) {
    resultA = "draw";
    resultB = "draw";
  } else if (portfolioA > portfolioB) {
    resultA = "win";
    resultB = "loss";
  } else {
    resultA = "loss";
    resultB = "win";
  }

  return { resultA, resultB };
}
