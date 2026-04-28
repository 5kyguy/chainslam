import type { AppConfig } from "../config.js";
import type { MatchService } from "./match-service.js";
import type { AgentService } from "./agent-service.js";
import { DummyMatchService } from "./dummy-match-service.js";
import { RealMatchService } from "./real-match-service.js";
import { UniswapClient } from "../integrations/uniswap.js";
import { KeeperHubClient } from "../integrations/keeperhub.js";
import { ExecutionService } from "./execution-service.js";
import { AppError } from "../errors.js";

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

    if (config.keeperhub.enabled && !config.keeperhub.apiKey) {
      throw new AppError("KEEPERHUB_CONFIG_MISSING", "KEEPERHUB_API_KEY is required when KEEPERHUB_ENABLED=true", {
        statusCode: 500,
      });
    }
    if (config.keeperhub.enabled && !uniswap) {
      throw new AppError("KEEPERHUB_CONFIG_MISSING", "UNISWAP_ENABLED=true and UNISWAP_API_KEY are required for KeeperHub-backed trades", {
        statusCode: 500,
      });
    }

    const keeperhub = config.keeperhub.enabled
      ? new KeeperHubClient(config.keeperhub)
      : undefined;
    const executionService = new ExecutionService(config, uniswap, keeperhub);

    return new RealMatchService(config, agentService, uniswap, executionService);
  }
  return new DummyMatchService(config);
}
