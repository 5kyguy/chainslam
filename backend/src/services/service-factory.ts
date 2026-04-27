import type { AppConfig } from "../config.js";
import type { MatchService } from "./match-service.js";
import type { AgentService } from "./agent-service.js";
import { DummyMatchService } from "./dummy-match-service.js";
import { RealMatchService } from "./real-match-service.js";

export function createMatchService(config: AppConfig, agentService: AgentService): MatchService {
  if (config.backendMode === "real") {
    return new RealMatchService(config, agentService);
  }
  return new DummyMatchService(config);
}
