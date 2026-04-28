import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import { matchCreateSchema, paramsWithIdSchema } from "../schemas/contracts.js";
import type { MatchCreateRequest } from "../types.js";

export async function registerHttpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/strategies", async () => app.matchService.getStrategies());

  app.get("/api/leaderboard", async () => app.matchService.getLeaderboard());

  app.post<{ Body: MatchCreateRequest }>("/api/matches", { schema: matchCreateSchema }, async (request, reply) => {
    const body = request.body;
    const created = await app.matchService.createMatch({
      agentA: body.agentA,
      agentB: body.agentB,
      tokenPair: body.tokenPair,
      startingCapitalUsd: body.startingCapitalUsd ?? 1000,
      durationSeconds: body.durationSeconds ?? 300
    });
    return reply.code(201).send(created);
  });

  app.get<{ Params: { id: string } }>("/api/matches/:id", { schema: paramsWithIdSchema }, async (request, reply) => {
    const match = app.matchService.getMatch(request.params.id);
    if (!match) {
      throw new AppError("MATCH_NOT_FOUND", "Match not found", {
        statusCode: 404,
        details: { matchId: request.params.id },
      });
    }
    return match;
  });

  app.get<{ Params: { id: string } }>(
    "/api/matches/:id/trades",
    { schema: paramsWithIdSchema },
    async (request, reply) => {
      const match = app.matchService.getMatch(request.params.id);
      if (!match) {
        throw new AppError("MATCH_NOT_FOUND", "Match not found", {
          statusCode: 404,
          details: { matchId: request.params.id },
        });
      }
      return app.matchService.getTrades(request.params.id);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/matches/:id/executions",
    { schema: paramsWithIdSchema },
    async (request) => {
      const match = app.matchService.getMatch(request.params.id);
      if (!match) {
        throw new AppError("MATCH_NOT_FOUND", "Match not found", {
          statusCode: 404,
          details: { matchId: request.params.id },
        });
      }
      return app.matchService.getExecutions(request.params.id);
    }
  );

  app.get<{ Params: { id: string } }>("/api/matches/:id/feed", { schema: paramsWithIdSchema }, async (request, reply) => {
    const match = app.matchService.getMatch(request.params.id);
    if (!match) {
      throw new AppError("MATCH_NOT_FOUND", "Match not found", {
        statusCode: 404,
        details: { matchId: request.params.id },
      });
    }
    return app.matchService.getFeed(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/matches/:id/stop", { schema: paramsWithIdSchema }, async (request, reply) => {
    const stopped = app.matchService.stopMatch(request.params.id);
    if (!stopped) {
      throw new AppError("MATCH_NOT_FOUND", "Match not found", {
        statusCode: 404,
        details: { matchId: request.params.id },
      });
    }
    return stopped;
  });
}
