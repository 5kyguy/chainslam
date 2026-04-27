import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { getConfig } from "./config.js";
import { registerHttpRoutes } from "./routes/http-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerWsRoutes } from "./routes/ws-routes.js";
import { createMatchService } from "./services/service-factory.js";
import { AgentService } from "./services/agent-service.js";
import type { MatchService } from "./services/match-service.js";

declare module "fastify" {
  interface FastifyInstance {
    matchService: MatchService;
    agentService: AgentService;
  }
}

export async function createApp() {
  const config = getConfig();
  const app = Fastify({ logger: true });

  const agentService = new AgentService(config);

  app.decorate("matchService", createMatchService(config, agentService));
  app.decorate("agentService", agentService);
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  await registerAgentRoutes(app);
  await registerHttpRoutes(app);
  await registerWsRoutes(app);

  return { app, config };
}
