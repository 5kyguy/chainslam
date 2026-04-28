import { Pool } from "pg";
import type { AgentState, AgentStats, DecisionEvent, LeaderboardEntry, MatchState, TradeEvent } from "../types.js";
import { InMemoryStore } from "./in-memory-store.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  strategy TEXT NOT NULL,
  prompt TEXT NOT NULL,
  risk_tolerance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  personality TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1200,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  avg_pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  token_pair TEXT NOT NULL,
  starting_capital_usd DOUBLE PRECISION NOT NULL,
  duration_seconds INTEGER NOT NULL,
  time_remaining_seconds DOUBLE PRECISION NOT NULL,
  eth_price DOUBLE PRECISION NOT NULL,
  contender_a_name TEXT NOT NULL,
  contender_a_pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  contender_a_portfolio_usd DOUBLE PRECISION NOT NULL,
  contender_a_trades INTEGER NOT NULL DEFAULT 0,
  contender_b_name TEXT NOT NULL,
  contender_b_pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  contender_b_portfolio_usd DOUBLE PRECISION NOT NULL,
  contender_b_trades INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  contender TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  sold_token TEXT NOT NULL,
  sold_amount DOUBLE PRECISION NOT NULL,
  bought_token TEXT NOT NULL,
  bought_amount DOUBLE PRECISION NOT NULL,
  gas_usd DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL,
  trade_record_id TEXT,
  execution_metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  contender TEXT NOT NULL,
  action TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reasoning TEXT,
  confidence DOUBLE PRECISION,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard (
  id SERIAL PRIMARY KEY,
  rank_pos INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  avg_pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL
);
`;

/** Applied after SCHEMA for databases created before KeeperHub audit columns existed */
const SCHEMA_MIGRATIONS = `
ALTER TABLE trades ADD COLUMN IF NOT EXISTS trade_record_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_metadata JSONB DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS trades_trade_record_id_uidx ON trades (trade_record_id) WHERE trade_record_id IS NOT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS contender_a_starting_capital_usd DOUBLE PRECISION;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS contender_b_starting_capital_usd DOUBLE PRECISION;
UPDATE matches SET contender_a_starting_capital_usd = starting_capital_usd WHERE contender_a_starting_capital_usd IS NULL;
UPDATE matches SET contender_b_starting_capital_usd = starting_capital_usd WHERE contender_b_starting_capital_usd IS NULL;
`;

export class PostgresStore extends InMemoryStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    super();
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  override async init(): Promise<void> {
    await this.pool.query(SCHEMA);
    await this.pool.query(SCHEMA_MIGRATIONS);
    await this.loadFromDb();
  }

  private async loadFromDb(): Promise<void> {
    const { rows: agents } = await this.pool.query("SELECT * FROM agents");
    for (const r of agents) {
      this.agentsById.set(r.id, rowToAgent(r));
    }

    const { rows: matches } = await this.pool.query("SELECT * FROM matches ORDER BY created_at ASC");
    for (const r of matches) {
      const mid = r.id as string;
      this.matchesById.set(mid, rowToMatch(r));

      const { rows: trades } = await this.pool.query("SELECT * FROM trades WHERE match_id = $1 ORDER BY id ASC", [mid]);
      this.tradeHistoryByMatchId.set(mid, trades.map(rowToTrade));

      const { rows: decs } = await this.pool.query("SELECT * FROM decisions WHERE match_id = $1 ORDER BY id ASC", [mid]);
      this.decisionFeedByMatchId.set(mid, decs.map(rowToDecision));
    }

    const { rows: lb } = await this.pool.query("SELECT * FROM leaderboard ORDER BY rank_pos ASC");
    if (lb.length > 0) {
      this.leaderboardEntries = lb.map(rowToLeaderboard);
    }
  }

  override saveMatch(match: MatchState): void {
    super.saveMatch(match);
    this.upsertMatch(match);
  }

  override updateMatch(match: MatchState): void {
    super.updateMatch(match);
    this.upsertMatch(match);
  }

  override addTrade(matchId: string, trade: TradeEvent): void {
    super.addTrade(matchId, trade);
    const executionMeta = executionMetadataFromTrade(trade);
    this.pool.query(
      `INSERT INTO trades (match_id, contender, tx_hash, sold_token, sold_amount, bought_token, bought_amount, gas_usd, created_at, trade_record_id, execution_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        matchId,
        trade.contender,
        trade.txHash,
        trade.sold.token,
        trade.sold.amount,
        trade.bought.token,
        trade.bought.amount,
        trade.gasUsd,
        trade.timestamp,
        trade.tradeRecordId ?? null,
        JSON.stringify(executionMeta),
      ],
    ).catch((err) => console.error("[PostgresStore] addTrade:", err));
  }

  override updateTradeExecution(matchId: string, tradeRecordId: string, patch: Partial<TradeEvent>): void {
    super.updateTradeExecution(matchId, tradeRecordId, patch);

    const metaPatch = executionPatchToJson(patch);
    const mergedJson = JSON.stringify(metaPatch);

    const newTxHash = patch.txHash ?? patch.onChainTxHash;

    this.pool.query(
      `UPDATE trades SET
        tx_hash = COALESCE($1::text, tx_hash),
        execution_metadata = COALESCE(execution_metadata, '{}'::jsonb) || $2::jsonb
       WHERE match_id = $3 AND trade_record_id = $4`,
      [newTxHash ?? null, mergedJson, matchId, tradeRecordId],
    ).catch((err) => console.error("[PostgresStore] updateTradeExecution:", err));
  }

  override addDecision(matchId: string, decision: DecisionEvent): void {
    super.addDecision(matchId, decision);
    this.pool.query(
      `INSERT INTO decisions (match_id, contender, action, amount, reasoning, confidence, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [matchId, decision.contender, decision.action, decision.amount, decision.reasoning, decision.confidence, decision.timestamp],
    ).catch((err) => console.error("[PostgresStore] addDecision:", err));
  }

  override setLeaderboard(entries: LeaderboardEntry[]): void {
    super.setLeaderboard(entries);
    const now = new Date().toISOString();
    this.pool.query("DELETE FROM leaderboard")
      .then(async () => {
        for (const e of entries) {
          await this.pool.query(
            `INSERT INTO leaderboard (rank_pos, strategy_name, rating, wins, losses, draws, avg_pnl_pct, matches_played, computed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [e.rank, e.strategy, e.rating, e.wins, e.losses, e.draws, e.avgPnlPct, e.matchesPlayed, now],
          );
        }
      })
      .catch((err) => console.error("[PostgresStore] setLeaderboard:", err));
  }

  override saveAgent(agent: AgentState): void {
    super.saveAgent(agent);
    this.upsertAgent(agent);
  }

  override deleteAgent(id: string): boolean {
    const ok = super.deleteAgent(id);
    if (ok) {
      this.pool.query("DELETE FROM agents WHERE id = $1", [id]).catch((err) => console.error("[PostgresStore] deleteAgent:", err));
    }
    return ok;
  }

  override updateAgentStatus(id: string, status: AgentState["status"]): void {
    super.updateAgentStatus(id, status);
    this.pool.query("UPDATE agents SET status = $1 WHERE id = $2", [status, id]).catch((err) => console.error("[PostgresStore] updateAgentStatus:", err));
  }

  override updateAgentStats(id: string, result: "win" | "loss" | "draw", pnlPct: number): void {
    super.updateAgentStats(id, result, pnlPct);
    const agent = this.agentsById.get(id);
    if (agent) {
      this.pool.query(
        "UPDATE agents SET rating=$1, matches_played=$2, wins=$3, losses=$4, draws=$5, avg_pnl_pct=$6 WHERE id=$7",
        [agent.stats.rating, agent.stats.matchesPlayed, agent.stats.wins, agent.stats.losses, agent.stats.draws, agent.stats.avgPnlPct, id],
      ).catch((err) => console.error("[PostgresStore] updateAgentStats:", err));
    }
  }

  override async close(): Promise<void> {
    await this.pool.end();
  }

  private upsertAgent(agent: AgentState): void {
    this.pool.query(
      `INSERT INTO agents (id, name, status, strategy, prompt, risk_tolerance, personality, created_at, rating, matches_played, wins, losses, draws, avg_pnl_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, status=EXCLUDED.status, strategy=EXCLUDED.strategy, prompt=EXCLUDED.prompt,
         risk_tolerance=EXCLUDED.risk_tolerance, personality=EXCLUDED.personality,
         rating=EXCLUDED.rating, matches_played=EXCLUDED.matches_played,
         wins=EXCLUDED.wins, losses=EXCLUDED.losses, draws=EXCLUDED.draws, avg_pnl_pct=EXCLUDED.avg_pnl_pct`,
      [agent.id, agent.name, agent.status, agent.strategy, agent.prompt, agent.riskTolerance, agent.personality, agent.createdAt,
        agent.stats.rating, agent.stats.matchesPlayed, agent.stats.wins, agent.stats.losses, agent.stats.draws, agent.stats.avgPnlPct],
    ).catch((err) => console.error("[PostgresStore] upsertAgent:", err));
  }

  private upsertMatch(match: MatchState): void {
    this.pool.query(
      `INSERT INTO matches (id, status, created_at, started_at, ends_at, token_pair, starting_capital_usd, duration_seconds,
         time_remaining_seconds, eth_price,
         contender_a_name, contender_a_pnl_pct, contender_a_portfolio_usd, contender_a_trades,
         contender_b_name, contender_b_pnl_pct, contender_b_portfolio_usd, contender_b_trades,
         contender_a_starting_capital_usd, contender_b_starting_capital_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, time_remaining_seconds=EXCLUDED.time_remaining_seconds, eth_price=EXCLUDED.eth_price,
         contender_a_pnl_pct=EXCLUDED.contender_a_pnl_pct, contender_a_portfolio_usd=EXCLUDED.contender_a_portfolio_usd,
         contender_a_trades=EXCLUDED.contender_a_trades,
         contender_b_pnl_pct=EXCLUDED.contender_b_pnl_pct, contender_b_portfolio_usd=EXCLUDED.contender_b_portfolio_usd,
         contender_b_trades=EXCLUDED.contender_b_trades`,
      [match.id, match.status, match.createdAt, match.startedAt, match.endsAt, match.tokenPair,
        match.startingCapitalUsd, match.durationSeconds, match.timeRemainingSeconds, match.ethPrice,
        match.contenders.A.name, match.contenders.A.pnlPct, match.contenders.A.portfolioUsd, match.contenders.A.trades,
        match.contenders.B.name, match.contenders.B.pnlPct, match.contenders.B.portfolioUsd, match.contenders.B.trades,
        match.contenders.A.startingCapitalUsd, match.contenders.B.startingCapitalUsd],
    ).catch((err) => console.error("[PostgresStore] upsertMatch:", err));
  }
}

type Row = Record<string, unknown>;

function rowToAgent(r: Row): AgentState {
  return {
    id: r.id as string,
    name: r.name as string,
    status: r.status as AgentState["status"],
    strategy: r.strategy as string,
    prompt: r.prompt as string,
    riskTolerance: Number(r.risk_tolerance),
    personality: r.personality as string,
    createdAt: r.created_at as string,
    stats: {
      rating: Number(r.rating),
      matchesPlayed: Number(r.matches_played),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      avgPnlPct: Number(r.avg_pnl_pct),
    },
  };
}

function rowToMatch(r: Row): MatchState {
  return {
    id: r.id as string,
    status: r.status as MatchState["status"],
    createdAt: r.created_at as string,
    startedAt: r.started_at as string,
    endsAt: r.ends_at as string,
    tokenPair: r.token_pair as string,
    startingCapitalUsd: Number(r.starting_capital_usd),
    durationSeconds: Number(r.duration_seconds),
    timeRemainingSeconds: Number(r.time_remaining_seconds),
    ethPrice: Number(r.eth_price),
    contenders: {
      A: {
        name: r.contender_a_name as string,
        startingCapitalUsd: Number(
          r.contender_a_starting_capital_usd != null ? r.contender_a_starting_capital_usd : r.starting_capital_usd,
        ),
        pnlPct: Number(r.contender_a_pnl_pct),
        portfolioUsd: Number(r.contender_a_portfolio_usd),
        trades: Number(r.contender_a_trades),
      },
      B: {
        name: r.contender_b_name as string,
        startingCapitalUsd: Number(
          r.contender_b_starting_capital_usd != null ? r.contender_b_starting_capital_usd : r.starting_capital_usd,
        ),
        pnlPct: Number(r.contender_b_pnl_pct),
        portfolioUsd: Number(r.contender_b_portfolio_usd),
        trades: Number(r.contender_b_trades),
      },
    },
  };
}

function executionMetadataFromTrade(trade: TradeEvent): Record<string, unknown> {
  const {
    event: _e,
    contender: _c,
    txHash: _tx,
    sold: _s,
    bought: _b,
    gasUsd: _g,
    timestamp: _t,
    tradeRecordId: _tr,
    ...rest
  } = trade;
  return rest as Record<string, unknown>;
}

function executionPatchToJson(patch: Partial<TradeEvent>): Record<string, unknown> {
  const skip = new Set([
    "event",
    "contender",
    "sold",
    "bought",
    "gasUsd",
    "timestamp",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (skip.has(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function rowToTrade(r: Row): TradeEvent {
  const metaRaw = r.execution_metadata;
  const meta =
    metaRaw !== null &&
    metaRaw !== undefined &&
    typeof metaRaw === "object" &&
    !Array.isArray(metaRaw)
      ? ({ ...(metaRaw as Record<string, unknown>) } as Partial<TradeEvent>)
      : ({} as Partial<TradeEvent>);

  const tradeRecordIdCol = r.trade_record_id != null ? String(r.trade_record_id) : undefined;

  const core: TradeEvent = {
    ...meta,
    event: "trade_executed",
    contender: r.contender as string,
    txHash: r.tx_hash as string,
    sold: { token: r.sold_token as string, amount: Number(r.sold_amount) },
    bought: { token: r.bought_token as string, amount: Number(r.bought_amount) },
    gasUsd: Number(r.gas_usd),
    timestamp: r.created_at as string,
    tradeRecordId: tradeRecordIdCol ?? meta.tradeRecordId,
  };

  return core;
}

function rowToDecision(r: Row): DecisionEvent {
  return {
    event: "decision",
    contender: r.contender as string,
    action: r.action as "buy" | "sell" | "hold",
    amount: Number(r.amount),
    reasoning: (r.reasoning as string) ?? "",
    confidence: Number(r.confidence) || 0,
    timestamp: r.created_at as string,
  };
}

function rowToLeaderboard(r: Row): LeaderboardEntry {
  return {
    rank: Number(r.rank_pos),
    strategy: r.strategy_name as string,
    rating: Number(r.rating),
    wins: Number(r.wins),
    losses: Number(r.losses),
    draws: Number(r.draws),
    avgPnlPct: Number(r.avg_pnl_pct),
    matchesPlayed: Number(r.matches_played),
  };
}
