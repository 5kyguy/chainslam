import OpenAI from "openai";
import type { AppConfig } from "../config.js";
import { isAnthropicProvider } from "../config.js";
import type { TickContext, StrategySignal, DecisionAction } from "../types.js";

const FALLBACK_SIGNAL: StrategySignal = {
  action: "hold",
  amount: 0,
  reasoning: "LLM call failed or returned invalid response. Defaulting to hold.",
  confidence: 0,
};

interface LLMResponse {
  action: string;
  amount: number;
  reasoning: string;
  confidence: number;
}

export class AgentRuntime {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly agentName: string;
  private readonly isAnthropic: boolean;

  constructor(
    private readonly config: AppConfig,
    agentName: string,
    compiledPrompt: string,
  ) {
    this.agentName = agentName;
    this.systemPrompt = compiledPrompt;
    this.model = config.llm.model;
    this.isAnthropic = isAnthropicProvider(config.llm.provider);

    this.client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
    });
  }

  async evaluate(context: TickContext): Promise<StrategySignal> {
    const userMessage = this.buildUserMessage(context);

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 256,
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      return this.parseResponse(raw);
    } catch (err) {
      console.error(`[${this.agentName}] LLM call failed:`, err);
      return FALLBACK_SIGNAL;
    }
  }

  private buildUserMessage(ctx: TickContext): string {
    const priceHistoryStr =
      ctx.priceHistory.length > 0
        ? `Recent prices: [${ctx.priceHistory.slice(-10).map((p) => p.toFixed(2)).join(", ")}]`
        : "No price history yet (first tick).";

    return [
      `Market: ${ctx.tokenPair}`,
      `Current price: $${ctx.ethPrice.toFixed(2)}`,
      priceHistoryStr,
      ``,
      `Your portfolio:`,
      `  USDC: ${ctx.usdcBalance.toFixed(2)}`,
      `  ${ctx.tokenPair.split("/")[0]}: ${ctx.ethBalance.toFixed(6)}`,
      `  Total USD value: $${ctx.portfolioUsd.toFixed(2)}`,
      `  PnL: ${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(2)}%`,
      `  Trades made: ${ctx.tradeCount}`,
      ``,
      `Tick ${ctx.tickNumber} | Ticks remaining: ${ctx.ticksRemaining}`,
      ``,
      `What is your decision?`,
    ].join("\n");
  }

  private parseResponse(raw: string): StrategySignal {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const parsed: LLMResponse = JSON.parse(cleaned);

      const action = this.validateAction(parsed.action);
      if (!action) {
        return FALLBACK_SIGNAL;
      }

      return {
        action,
        amount: Math.max(0, Number(parsed.amount) || 0),
        reasoning: String(parsed.reasoning || "").slice(0, 500),
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      };
    } catch {
      console.error(`[${this.agentName}] Failed to parse LLM response:`, raw);
      return FALLBACK_SIGNAL;
    }
  }

  private validateAction(raw: string): DecisionAction | null {
    const normalized = String(raw).toLowerCase().trim();
    if (normalized === "buy" || normalized === "sell" || normalized === "hold") {
      return normalized;
    }
    return null;
  }
}
