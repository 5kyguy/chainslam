import type { AppConfig } from "../config.js";
import type { Store } from "../store/store.js";
import { AgentRegistry } from "../agents/agent-registry.js";
import { compileStrategyPrompt, isValidStrategyId } from "../agents/strategies/strategy-compiler.js";
import { STRATEGIES } from "./strategy-catalog.js";
import type { AgentCreateRequest, AgentState } from "../types.js";

export class AgentService {
  private readonly registry: AgentRegistry;

  constructor(private readonly config: AppConfig, store: Store) {
    this.registry = new AgentRegistry(store);
  }

  create(input: AgentCreateRequest): AgentState {
    if (!isValidStrategyId(input.strategy)) {
      throw new Error(
        `Unknown strategy: "${input.strategy}". Valid options: ${[...STRATEGIES.map((s) => s.id), "custom"].join(", ")}`,
      );
    }

    const compiledPrompt = compileStrategyPrompt(input.strategy, {
      prompt: input.prompt,
      riskTolerance: input.riskTolerance,
      personality: input.personality,
      trading: {
        minTradeUsd: this.config.trading.minTradeUsd,
        maxTradeUsdAbsolute: this.config.trading.maxTradeUsdAbsolute,
      },
    });

    return this.registry.create(input, compiledPrompt);
  }

  get(id: string): AgentState | undefined {
    return this.registry.get(id);
  }

  list(): AgentState[] {
    return this.registry.list();
  }

  delete(id: string): boolean {
    return this.registry.delete(id);
  }

  setStatus(id: string, status: AgentState["status"]): void {
    this.registry.setStatus(id, status);
  }

  updateStats(id: string, result: "win" | "loss" | "draw", pnlPct: number): void {
    this.registry.updateStats(id, result, pnlPct);
  }
}
