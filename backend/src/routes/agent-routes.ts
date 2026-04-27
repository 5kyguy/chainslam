import type { FastifyInstance } from "fastify";
import { paramsWithIdSchema } from "../schemas/contracts.js";
import type { AgentCreateRequest } from "../types.js";

const agentCreateSchema = {
  body: {
    type: "object",
    required: ["name", "strategy"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      strategy: { type: "string", minLength: 1 },
      prompt: { type: "string", maxLength: 5000 },
      riskTolerance: { type: "number", minimum: 0, maximum: 1 },
      personality: { type: "string", maxLength: 200 },
    },
  },
} as const;

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AgentCreateRequest }>("/api/agents", { schema: agentCreateSchema }, async (request, reply) => {
    try {
      const agent = app.agentService.create(request.body);
      return reply.code(201).send(agent);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create agent";
      return reply.code(400).send({ message });
    }
  });

  app.get("/api/agents", async () => app.agentService.list());

  app.get<{ Params: { id: string } }>("/api/agents/:id", { schema: paramsWithIdSchema }, async (request, reply) => {
    const agent = app.agentService.get(request.params.id);
    if (!agent) {
      return reply.code(404).send({ message: "Agent not found" });
    }
    return agent;
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", { schema: paramsWithIdSchema }, async (request, reply) => {
    const deleted = app.agentService.delete(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ message: "Agent not found or currently in a match" });
    }
    return reply.code(204).send();
  });
}
