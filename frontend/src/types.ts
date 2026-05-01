export type MatchStatus = "created" | "running" | "completed" | "stopped";
export type DecisionAction = "buy" | "sell" | "hold";
export type AgentStatus = "ready" | "in_match" | "destroyed";
export type WsStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface StrategyOption {
  id: string;
  name: string;
  riskProfile: string;
  description: string;
}

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
  startingCapitalUsd?: number;
  startingCapitalUsdA?: number;
  startingCapitalUsdB?: number;
  durationSeconds: number;
}

export interface ContenderState {
  name: string;
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
  executionMode?: "paper" | "uniswap_quote_mock" | "uniswap_live_swap";
  quoteRouting?: string;
  mockSwapBuild?: {
    mode?: string;
    chainId?: number;
    routing?: string;
    quoteSnippet?: { amountIn?: string; amountOut?: string };
    note?: string;
  };
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
  tradeRecordId?: string;
  keeperhubSubmissionId?: string;
  keeperhubStatus?: string;
  keeperhubRetryCount?: number;
  onChainTxHash?: string;
  executionReceipt?: Record<string, unknown>;
  lastExecutionError?: string;
  keeperhubTransactionLink?: string;
}

export interface KeeperHubExecutionAudit {
  tradeRecordId: string;
  contender: string;
  timestamp: string;
  executionMode?: TradeEvent["executionMode"];
  sold: TradeEvent["sold"];
  bought: TradeEvent["bought"];
  keeperhubSubmissionId?: string;
  keeperhubStatus?: string;
  keeperhubRetryCount?: number;
  onChainTxHash?: string;
  keeperhubTransactionLink?: string;
  lastExecutionError?: string;
  executionReceipt?: Record<string, unknown>;
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

export interface WsEnvelope {
  event: "snapshot" | "decision" | "trade_executed" | "completed" | "stopped";
  match_id: string;
  timestamp: string;
  payload: unknown;
}

export type MemoryEventKind = "match_started" | "decision" | "trade_executed" | "match_completed" | "match_stopped";

export interface MemoryEvent {
  schemaVersion: 1;
  kind: MemoryEventKind;
  ts: string;
  matchId: string;
  agentId?: string;
  contenderName?: string;
  payload: Record<string, unknown>;
}

export interface MemoryPage {
  events: MemoryEvent[];
  nextCursor: number | null;
  source: "memory" | "zerog";
  lastTxHash?: string;
}

export interface ZeroGSnapshot {
  raw: string | null;
  configured: boolean;
}

export interface SeriesPoint {
  t: string;
  A: number;
  B: number;
  price: number;
}

export interface StartMatchInput {
  strategyA: string;
  strategyB: string;
  tokenPair: string;
  durationSeconds: number;
  startingCapitalUsd: number;
  demoMode: boolean;
}
