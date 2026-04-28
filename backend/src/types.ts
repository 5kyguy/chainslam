export type MatchStatus = "created" | "running" | "completed" | "stopped";
export type DecisionAction = "buy" | "sell" | "hold";
export type AgentStatus = "ready" | "in_match" | "destroyed";

export interface AgentStats {
  rating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  avgPnlPct: number;
}

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  strategy: string;
  prompt: string;
  riskTolerance: number;
  personality: string;
  createdAt: string;
  stats: AgentStats;
}

export interface AgentCreateRequest {
  name: string;
  strategy: string;
  prompt?: string;
  riskTolerance?: number;
  personality?: string;
}

export interface MatchCreateRequest {
  agentA: string;
  agentB: string;
  tokenPair: string;
  /**
   * Shared per-contender starting USD when `startingCapitalUsdA` / `startingCapitalUsdB` are omitted.
   * Minimum 1.
   */
  startingCapitalUsd?: number;
  /** Optional per-contender bankrolls (must set both or neither). Minimum 1 each. */
  startingCapitalUsdA?: number;
  startingCapitalUsdB?: number;
  durationSeconds: number;
}

export interface ContenderState {
  name: string;
  /** Initial USDC bankroll for this contender (PnL denominator). */
  startingCapitalUsd: number;
  pnlPct: number;
  portfolioUsd: number;
  trades: number;
}

export interface MatchState {
  id: string;
  status: MatchStatus;
  createdAt: string;
  startedAt: string;
  endsAt: string;
  tokenPair: string;
  /**
   * Legacy aggregate for APIs: `max(starting capital A, starting capital B)` at match creation.
   */
  startingCapitalUsd: number;
  durationSeconds: number;
  timeRemainingSeconds: number;
  ethPrice: number;
  contenders: {
    A: ContenderState;
    B: ContenderState;
  };
}

export interface DecisionEvent {
  event: "decision";
  contender: string;
  action: DecisionAction;
  amount: number;
  reasoning: string;
  confidence: number;
  timestamp: string;
}

export interface TradeEvent {
  event: "trade_executed";
  contender: string;
  txHash: string;
  sold: { token: string; amount: number };
  bought: { token: string; amount: number };
  gasUsd: number;
  timestamp: string;
  /** Present when sizes came from Uniswap `/quote` (paper fill, no chain). */
  executionMode?: "paper" | "uniswap_quote_mock" | "uniswap_live_swap";
  quoteRouting?: string;
  mockSwapBuild?: {
    mode?: string;
    chainId?: number;
    routing?: string;
    quoteSnippet?: { amountIn?: string; amountOut?: string };
    note?: string;
  };
  /** Unsigned tx from real `POST /swap` (`UNISWAP_SWAP_MODE=live`). Sign and broadcast via your wallet/RPC. */
  unsignedSwap?: {
    to?: string;
    from?: string;
    data?: string;
    value?: string;
    chainId?: number;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasFee?: string;
  };
  swapRequestId?: string;
  swapError?: string;
  approvalRequestId?: string;

  /** Stable id for correlating async KeeperHub execution updates (persisted in Postgres). */
  tradeRecordId?: string;

  /** KeeperHub Direct Execution id (`POST /execute/contract-call`). */
  keeperhubSubmissionId?: string;
  /** Normalized KeeperHub execution status (`pending` | `running` | `completed` | `failed`, etc.). */
  keeperhubStatus?: string;
  /** HTTP retries consumed by the KeeperHub client for submit/status calls (not poll attempts). */
  keeperhubRetryCount?: number;
  /** On-chain transaction hash when execution finalizes (authoritative over placeholder `txHash` when set). */
  onChainTxHash?: string;
  /** Full status payload / `result` from KeeperHub for audit. */
  executionReceipt?: Record<string, unknown>;
  lastExecutionError?: string;
  /** Block explorer link from KeeperHub status when available. */
  keeperhubTransactionLink?: string;
}

export type FeedEvent = DecisionEvent | TradeEvent;

export interface LeaderboardEntry {
  rank: number;
  strategy: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  avgPnlPct: number;
  matchesPlayed: number;
}

export interface TickContext {
  tokenPair: string;
  ethPrice: number;
  priceHistory: number[];
  usdcBalance: number;
  ethBalance: number;
  portfolioUsd: number;
  pnlPct: number;
  tradeCount: number;
  tickNumber: number;
  ticksRemaining: number;
  /** Matches server `MIN_TRADE_USD`; Python strategies should use instead of hardcoded $10. */
  minTradeUsd: number;
  /** Max USD notional per trade for this contender (server clamp); strategies should stay within this band. */
  maxTradeUsd: number;
}

export interface StrategySignal {
  action: DecisionAction;
  amount: number;
  reasoning: string;
  confidence: number;
}

export interface WsEnvelope {
  event: "snapshot" | "decision" | "trade_executed" | "completed" | "stopped";
  match_id: string;
  timestamp: string;
  payload: unknown;
}
