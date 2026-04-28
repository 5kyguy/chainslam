import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { getConfig } from "./config.js";
import { AppError, errorEnvelope, isAppError } from "./errors.js";
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
  const app = Fastify({
    logger: true,
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      if (Array.isArray(incoming)) return incoming[0] ?? randomUUID();
      return incoming ?? randomUUID();
    },
  });

  const agentService = new AgentService(config);

  app.decorate("matchService", createMatchService(config, agentService));
  app.decorate("agentService", agentService);

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { validation?: unknown };
    if (isAppError(error)) {
      return reply.code(error.statusCode).send(errorEnvelope(error, request.id));
    }

    if (err.validation) {
      const validationError = new AppError("VALIDATION_ERROR", "Request validation failed", {
        statusCode: 400,
        details: { validation: err.validation },
        cause: error,
      });
      return reply.code(400).send(errorEnvelope(validationError, request.id));
    }

    request.log.error({ err: error }, "Unhandled request error");
    const internal = new AppError("INTERNAL_ERROR", "Internal server error", {
      statusCode: 500,
      cause: error,
    });
    return reply.code(500).send(errorEnvelope(internal, request.id));
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  await registerAgentRoutes(app);
  await registerHttpRoutes(app);
  await registerWsRoutes(app);

  return { app, config };
}
