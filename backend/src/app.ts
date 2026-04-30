import "./load-env.js";

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { getConfig } from "./config.js";
import { registerHttpRoutes } from "./routes/http-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerWsRoutes } from "./routes/ws-routes.js";
import { registerAgentWsRoutes } from "./routes/agent-ws-routes.js";
import { buildMatchServiceBundle } from "./services/service-factory.js";
import { AgentService } from "./services/agent-service.js";
import { AgentProcessManager } from "./agents/process-manager.js";
import { createStore } from "./store/index.js";
import { isValidPrivateKey } from "./integrations/permit2-signer.js";
import type { MatchService } from "./services/match-service.js";
import type { Store } from "./store/store.js";

declare module "fastify" {
  interface FastifyInstance {
    matchService: MatchService;
    agentService: AgentService;
  }
}

export async function createApp() {
  const config = getConfig();
  const app = Fastify({ logger: true });

  const store = createStore(config.databaseUrl);
  await store.init();

  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  const wsBaseUrl = `ws://${host}:${config.port}`;

  const processManager = new AgentProcessManager(config, wsBaseUrl);
  const agentService = new AgentService(config, store);

  const { matchService, keeperHubPoller } = buildMatchServiceBundle(config, agentService, store, processManager);
  keeperHubPoller?.start();

  if (config.wallet.privateKey.trim().length > 0 && isValidPrivateKey(config.wallet.privateKey)) {
    if (config.uniswap.swapMode !== "live") {
      console.warn("[Wallet] WALLET_PRIVATE_KEY is set but UNISWAP_SWAP_MODE is not 'live' — on-chain swaps will not execute.");
    }
    if (config.keeperhub.apiKey.trim().length === 0) {
      console.warn("[Wallet] WALLET_PRIVATE_KEY is set but KEEPERHUB_API_KEY is empty — KeeperHub is required to execute signed swaps on-chain.");
    }
  }

  app.decorate("matchService", matchService);
  app.decorate("agentService", agentService);
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  await registerAgentRoutes(app);
  await registerHttpRoutes(app);
  await registerWsRoutes(app);
  await registerAgentWsRoutes(app, processManager);

  return { app, config, store, processManager };
}
