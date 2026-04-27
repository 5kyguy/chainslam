import { randomUUID } from "node:crypto";
import type { AgentCreateRequest, AgentState, AgentStats } from "../types.js";

const DEFAULT_STATS: AgentStats = {
  rating: 1200,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  avgPnlPct: 0,
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentState>();

  create(input: AgentCreateRequest, compiledPrompt: string): AgentState {
    const id = `agent_${randomUUID().slice(0, 8)}`;
    const agent: AgentState = {
      id,
      name: input.name,
      status: "ready",
      strategy: input.strategy,
      prompt: compiledPrompt,
      riskTolerance: input.riskTolerance ?? 0.5,
      personality: input.personality ?? "",
      createdAt: new Date().toISOString(),
      stats: { ...DEFAULT_STATS },
    };
    this.agents.set(id, agent);
    return agent;
  }

  get(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  list(): AgentState[] {
    return [...this.agents.values()];
  }

  delete(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent || agent.status === "in_match") {
      return false;
    }
    agent.status = "destroyed";
    this.agents.delete(id);
    return true;
  }

  setStatus(id: string, status: AgentState["status"]): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
    }
  }

  updateStats(id: string, result: "win" | "loss" | "draw", pnlPct: number): void {
    const agent = this.agents.get(id);
    if (!agent) {
      return;
    }
    const s = agent.stats;
    s.matchesPlayed += 1;
    if (result === "win") s.wins += 1;
    else if (result === "loss") s.losses += 1;
    else s.draws += 1;

    const totalPnl = s.avgPnlPct * (s.matchesPlayed - 1) + pnlPct;
    s.avgPnlPct = Number(totalPnl.toFixed(2));
  }
}
