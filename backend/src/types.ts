export type MatchStatus = "created" | "running" | "completed" | "stopped";
export type DecisionAction = "buy" | "sell" | "hold";
export type AgentStatus = "ready" | "in_match" | "destroyed";
export type ExecutionProvider = "keeperhub" | "simulated";
export type ExecutionStatus = "submitted" | "pending" | "running" | "completed" | "failed";

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
  startingCapitalUsd: number;
  durationSeconds: number;
}

export interface ContenderState {
  name: string;
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

export interface ExecutionErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TradeExecutionMetadata {
  executionProvider: ExecutionProvider;
  executionStatus: ExecutionStatus;
  keeperExecutionId?: string;
  transactionHash?: string;
  transactionLink?: string;
  gasUsedWei?: string;
  executionError?: ExecutionErrorDetail;
  idempotencyKey?: string;
}

export interface TradeEvent {
  event: "trade_executed";
  contender: string;
  txHash: string;
  sold: { token: string; amount: number };
  bought: { token: string; amount: number };
  gasUsd: number;
  timestamp: string;
  executionProvider: ExecutionProvider;
  executionStatus: "completed";
  keeperExecutionId?: string;
  transactionHash?: string;
  transactionLink?: string;
  gasUsedWei?: string;
  idempotencyKey?: string;
}

export interface TradeSubmittedEvent {
  event: "trade_submitted";
  contender: string;
  action: Exclude<DecisionAction, "hold">;
  sold: { token: string; amount: number };
  expectedBought: { token: string; amount: number };
  timestamp: string;
  executionProvider: ExecutionProvider;
  executionStatus: "submitted" | "pending" | "running" | "completed";
  keeperExecutionId?: string;
  idempotencyKey?: string;
}

export interface TradeFailedEvent {
  event: "trade_failed";
  contender: string;
  action: Exclude<DecisionAction, "hold">;
  sold?: { token: string; amount: number };
  expectedBought?: { token: string; amount: number };
  txHash?: string;
  timestamp: string;
  executionProvider: ExecutionProvider;
  executionStatus: "failed";
  keeperExecutionId?: string;
  transactionHash?: string;
  transactionLink?: string;
  gasUsedWei?: string;
  executionError: ExecutionErrorDetail;
  idempotencyKey?: string;
}

export type FeedEvent = DecisionEvent | TradeEvent | TradeSubmittedEvent | TradeFailedEvent;

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
}

export interface StrategySignal {
  action: DecisionAction;
  amount: number;
  reasoning: string;
  confidence: number;
}

export interface WsEnvelope {
  event: "snapshot" | "decision" | "trade_submitted" | "trade_executed" | "trade_failed" | "completed" | "stopped";
  match_id: string;
  timestamp: string;
  payload: unknown;
}
