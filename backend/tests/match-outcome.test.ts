import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMatchOutcome,
  OUTCOME_PORTFOLIO_USD_EPS,
  OUTCOME_RELATIVE_PNL_TOLERANCE_PCT,
} from "../src/services/match-outcome.js";
import type { MatchState } from "../src/types.js";

function baseMatch(overrides: Partial<MatchState>): MatchState {
  const base: MatchState = {
    id: "m1",
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    tokenPair: "WETH/USDC",
    startingCapitalUsd: 1000,
    durationSeconds: 60,
    timeRemainingSeconds: 30,
    ethPrice: 3000,
    contenders: {
      A: { name: "A", portfolioUsd: 1000, pnlPct: 0, trades: 0 },
      B: { name: "B", portfolioUsd: 1000, pnlPct: 0, trades: 0 },
    },
  };
  return { ...base, ...overrides };
}

test("computeMatchOutcome — clear PnL gap picks winner", () => {
  const m = baseMatch({
    contenders: {
      A: { name: "A", pnlPct: 5, portfolioUsd: 1050, trades: 0 },
      B: { name: "B", pnlPct: 1, portfolioUsd: 1010, trades: 0 },
    },
  });
  const o = computeMatchOutcome(m);
  assert.equal(o.resultA, "win");
  assert.equal(o.resultB, "loss");
});

test("computeMatchOutcome — small PnL gap uses portfolio tie-break", () => {
  const gap = OUTCOME_RELATIVE_PNL_TOLERANCE_PCT - 0.01;
  const m = baseMatch({
    contenders: {
      A: { name: "A", pnlPct: 1, portfolioUsd: 1000, trades: 0 },
      B: {
        name: "B",
        pnlPct: 1 + gap,
        portfolioUsd: 1000 + OUTCOME_PORTFOLIO_USD_EPS * 2,
        trades: 0,
      },
    },
  });
  const o = computeMatchOutcome(m);
  assert.equal(o.resultB, "win");
  assert.equal(o.resultA, "loss");
});

test("computeMatchOutcome — draw when close PnL and portfolios match", () => {
  const m = baseMatch({
    contenders: {
      A: { name: "A", pnlPct: 1, portfolioUsd: 1000, trades: 0 },
      B: { name: "B", pnlPct: 1.1, portfolioUsd: 1000, trades: 0 },
    },
  });
  const o = computeMatchOutcome(m);
  assert.equal(o.resultA, "draw");
  assert.equal(o.resultB, "draw");
});
