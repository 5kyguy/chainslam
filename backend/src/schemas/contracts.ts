export const matchCreateSchema = {
  body: {
    type: "object",
    required: ["agentA", "agentB", "tokenPair"],
    properties: {
      agentA: { type: "string", minLength: 1 },
      agentB: { type: "string", minLength: 1 },
      tokenPair: { type: "string", minLength: 3 },
      startingCapitalUsd: { type: "number", minimum: 1, default: 1000 },
      startingCapitalUsdA: { type: "number", minimum: 1 },
      startingCapitalUsdB: { type: "number", minimum: 1 },
      durationSeconds: { type: "number", minimum: 30, default: 300 }
    }
  }
} as const;

export const paramsWithIdSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1 }
    }
  }
} as const;

/** Query params for `/api/matches/:id/memory` and `/api/agents/:id/memory` */
export const memoryListQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      cursor: { type: "integer", minimum: 0, default: 0 },
    },
  },
} as const;
