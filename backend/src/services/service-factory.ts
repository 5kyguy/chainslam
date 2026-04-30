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
import { Permit2Signer, isValidPrivateKey } from "../integrations/permit2-signer.js";

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
  let permit2Signer: Permit2Signer | undefined;
  if (config.wallet.privateKey.trim().length > 0) {
    if (isValidPrivateKey(config.wallet.privateKey)) {
      permit2Signer = new Permit2Signer({ privateKey: config.wallet.privateKey });
      console.log(`[Wallet] Permit2 signer ready for address: ${permit2Signer.address}`);
    } else {
      console.warn("[Wallet] WALLET_PRIVATE_KEY is set but invalid — Permit2 signing disabled.");
    }
  }

  const swapperAddress = permit2Signer
    ? permit2Signer.address
    : config.uniswap.swapperAddress;

  const uniswap = new UniswapClient({
    apiKey: config.uniswap.apiKey,
    baseUrl: config.uniswap.baseUrl,
    chainId: config.uniswap.chainId,
    swapperAddress,
    timeoutMs: config.uniswap.timeoutMs,
    maxRetries: config.uniswap.maxRetries,
    permit2Disabled: config.uniswap.permit2Disabled,
    universalRouterVersion: config.uniswap.universalRouterVersion,
    permitSignature: permit2Signer ? "" : config.uniswap.permitSignature,
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
    permit2Signer,
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
