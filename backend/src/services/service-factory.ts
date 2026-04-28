import type { AppConfig } from "../config.js";
import type { MatchService } from "./match-service.js";
import type { AgentService } from "./agent-service.js";
import type { Store } from "../store/store.js";
import type { AgentProcessManager } from "../agents/process-manager.js";
import { RealMatchService } from "./real-match-service.js";
import { UniswapClient } from "../integrations/uniswap.js";
import { KeeperHubClient } from "../integrations/keeperhub.js";
import { KeeperHubExecutionPoller } from "./keeperhub-execution-poller.js";
import { ZeroGKvClient } from "../integrations/zerog.js";
import { ZeroGMemoryService } from "./zerog-memory-service.js";

export interface MatchServiceBundle {
  matchService: MatchService;
  keeperHubPoller?: KeeperHubExecutionPoller;
}

export function buildMatchServiceBundle(
  config: AppConfig,
  agentService: AgentService,
  store: Store,
  processManager: AgentProcessManager,
): MatchServiceBundle {
  const uniswap = new UniswapClient({
    apiKey: config.uniswap.apiKey,
    baseUrl: config.uniswap.baseUrl,
    chainId: config.uniswap.chainId,
    swapperAddress: config.uniswap.swapperAddress,
    timeoutMs: config.uniswap.timeoutMs,
    maxRetries: config.uniswap.maxRetries,
    permit2Disabled: config.uniswap.permit2Disabled,
    universalRouterVersion: config.uniswap.universalRouterVersion,
    permitSignature: config.uniswap.permitSignature,
  });

  const khCfg = config.keeperhub;
  const keeperHub =
    khCfg.apiKey.trim().length > 0
      ? new KeeperHubClient({
          apiKey: khCfg.apiKey,
          baseUrl: khCfg.baseUrl,
          timeoutMs: khCfg.timeoutMs,
          maxRetries: khCfg.maxRetries,
        })
      : undefined;

  const keeperHubPoller =
    keeperHub !== undefined ? new KeeperHubExecutionPoller(store, keeperHub, khCfg) : undefined;

  let zeroGMemory: ZeroGMemoryService | undefined;
  if (config.zerog.enabled) {
    const zkv = new ZeroGKvClient(config.zerog);
    zeroGMemory = new ZeroGMemoryService(config, zkv.isConfigured() ? zkv : undefined);
    if (config.zerog.enabled && !zkv.isConfigured()) {
      console.warn(
        "[ZeroG] ZEROG_ENABLED is true but KV credentials are incomplete — memory stays in-process only (no 0G writes).",
      );
    }
  }

  const matchService = new RealMatchService(
    config,
    agentService,
    store,
    processManager,
    uniswap,
    keeperHub,
    keeperHubPoller,
    zeroGMemory,
  );

  return { matchService, keeperHubPoller };
}

export function createMatchService(
  config: AppConfig,
  agentService: AgentService,
  store: Store,
  processManager: AgentProcessManager,
): MatchService {
  return buildMatchServiceBundle(config, agentService, store, processManager).matchService;
}
