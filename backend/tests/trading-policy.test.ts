import test from "node:test";
import assert from "node:assert/strict";
import { clampMaxTradeUsd, pnlPctFromPortfolio } from "../src/services/trading-policy.js";

test("clampMaxTradeUsd — percent-of-capital only when absolute cap is unlimited", () => {
  assert.equal(clampMaxTradeUsd(1000, { maxTradeUsdAbsolute: Number.POSITIVE_INFINITY }), 500);
  assert.equal(clampMaxTradeUsd(2, { maxTradeUsdAbsolute: Number.POSITIVE_INFINITY }), 1);
});

test("clampMaxTradeUsd — absolute cap wins when smaller than pct", () => {
  assert.equal(clampMaxTradeUsd(1000, { maxTradeUsdAbsolute: 1 }), 1);
  assert.equal(clampMaxTradeUsd(1, { maxTradeUsdAbsolute: 1 }), 0.5);
});

test("pnlPctFromPortfolio — uses per-contender starting capital", () => {
  assert.equal(pnlPctFromPortfolio(1.1, 1), 10);
  assert.equal(pnlPctFromPortfolio(1000, 1000), 0);
});
