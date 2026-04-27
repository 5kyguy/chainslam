export const matchCreateSchema = {
  body: {
    type: "object",
    required: ["agentA", "agentB", "tokenPair"],
    properties: {
      agentA: { type: "string", minLength: 1 },
      agentB: { type: "string", minLength: 1 },
      tokenPair: { type: "string", minLength: 3 },
      startingCapitalUsd: { type: "number", minimum: 10, default: 1000 },
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
