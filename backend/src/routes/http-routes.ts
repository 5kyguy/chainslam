import type { FastifyInstance } from "fastify";
import { matchCreateSchema, paramsWithIdSchema } from "../schemas/contracts.js";
import type { MatchCreateRequest } from "../types.js";

export async function registerHttpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/strategies", async () => app.matchService.getStrategies());

  app.get("/api/leaderboard", async () => app.matchService.getLeaderboard());

  app.post<{ Body: MatchCreateRequest }>("/api/matches", { schema: matchCreateSchema }, async (request, reply) => {
    const body = request.body;
    const created = app.matchService.createMatch({
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
      return reply.code(404).send({ message: "Match not found" });
    }
    return match;
  });

  app.get<{ Params: { id: string } }>(
    "/api/matches/:id/trades",
    { schema: paramsWithIdSchema },
    async (request, reply) => {
      const match = app.matchService.getMatch(request.params.id);
      if (!match) {
        return reply.code(404).send({ message: "Match not found" });
      }
      return app.matchService.getTrades(request.params.id);
    }
  );

  app.get<{ Params: { id: string } }>("/api/matches/:id/feed", { schema: paramsWithIdSchema }, async (request, reply) => {
    const match = app.matchService.getMatch(request.params.id);
    if (!match) {
      return reply.code(404).send({ message: "Match not found" });
    }
    return app.matchService.getFeed(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/matches/:id/stop", { schema: paramsWithIdSchema }, async (request, reply) => {
    const stopped = app.matchService.stopMatch(request.params.id);
    if (!stopped) {
      return reply.code(404).send({ message: "Match not found" });
    }
    return stopped;
  });
}
