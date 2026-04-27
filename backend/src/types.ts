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

export interface TradeEvent {
  event: "trade_executed";
  contender: string;
  txHash: string;
  sold: { token: string; amount: number };
  bought: { token: string; amount: number };
  gasUsd: number;
  timestamp: string;
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
