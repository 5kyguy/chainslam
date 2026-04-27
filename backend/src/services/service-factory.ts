import type { AppConfig } from "../config.js";
import type { MatchService } from "./match-service.js";
import type { AgentService } from "./agent-service.js";
import { DummyMatchService } from "./dummy-match-service.js";
import { RealMatchService } from "./real-match-service.js";
import { UniswapClient } from "../integrations/uniswap.js";

export function createMatchService(config: AppConfig, agentService: AgentService): MatchService {
  if (config.backendMode === "real") {
    const uniswap = config.uniswap.enabled && config.uniswap.apiKey
      ? new UniswapClient({
          apiKey: config.uniswap.apiKey,
          baseUrl: config.uniswap.baseUrl,
          chainId: config.uniswap.chainId,
          swapperAddress: config.uniswap.swapperAddress,
          timeoutMs: config.uniswap.timeoutMs,
          maxRetries: config.uniswap.maxRetries,
        })
      : undefined;

    return new RealMatchService(config, agentService, uniswap);
  }
  return new DummyMatchService(config);
}
