import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AppError, toExecutionError } from "../errors.js";
import type { KeeperHubClient, KeeperHubExecutionStatus } from "../integrations/keeperhub.js";
import type { KeeperCompatibleContractCall, SwapBuildResult, SwapQuoteResult, UniswapClient } from "../integrations/uniswap.js";
import type {
  DecisionAction,
  ExecutionProvider,
  TradeEvent,
  TradeFailedEvent,
  TradeSubmittedEvent,
} from "../types.js";

interface ExecuteTradeInput {
  matchId: string;
  contender: string;
  action: Exclude<DecisionAction, "hold">;
  tokenPair: string;
  signalAmount: number;
  currentPrice: number;
  usdcBalance: number;
  ethBalance: number;
  startingCapitalUsd: number;
  tickNumber: number;
}

interface PlannedTrade {
  action: Exclude<DecisionAction, "hold">;
  baseToken: string;
  quoteToken: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountInHuman: number;
  sold: { token: string; amount: number };
  expectedBought: { token: string; amount: number };
  usdcDelta: number;
  ethDelta: number;
}

interface ExecuteTradeHooks {
  onSubmitted?: (event: TradeSubmittedEvent) => void;
}

export type ExecuteTradeOutcome =
  | { type: "skipped"; reason: string }
  | { type: "executed"; event: TradeEvent; usdcDelta: number; ethDelta: number }
  | { type: "failed"; event: TradeFailedEvent };

export class ExecutionService {
  constructor(
    private readonly config: AppConfig,
    private readonly uniswap?: UniswapClient,
    private readonly keeperhub?: KeeperHubClient,
  ) {}

  async executeTrade(input: ExecuteTradeInput, hooks: ExecuteTradeHooks = {}): Promise<ExecuteTradeOutcome> {
    const planned = this.planTrade(input);
    if (!planned) {
      return { type: "skipped", reason: "Trade is below minimum size or exceeds available balance." };
    }

    const idempotencyKey = this.buildIdempotencyKey(input, planned);

    if (!this.config.keeperhub.enabled || !this.keeperhub || !this.uniswap) {
      return this.simulateExecution(input, planned, idempotencyKey);
    }

    try {
      const quote = await this.uniswap.getQuote({
        tokenInSymbol: planned.tokenInSymbol,
        tokenOutSymbol: planned.tokenOutSymbol,
        amountHuman: planned.amountInHuman,
      });
      const swap = await this.uniswap.buildSwap(quote);

      await this.executeApprovalIfNeeded(quote, swap, idempotencyKey);

      const contractCall = this.requireKeeperCompatibleSwapCall(swap);
      const submitted = await this.keeperhub.executeContractCall(contractCall, { idempotencyKey });

      hooks.onSubmitted?.(this.buildSubmittedEvent(input, planned, submitted, idempotencyKey));

      const finalStatus = await this.keeperhub.waitForCompletion(submitted);
      if (finalStatus.status !== "completed") {
        return {
          type: "failed",
          event: this.buildFailedEvent(input, planned, finalStatus, idempotencyKey),
        };
      }

      return {
        type: "executed",
        usdcDelta: planned.usdcDelta,
        ethDelta: planned.ethDelta,
        event: this.buildExecutedEvent(input, planned, finalStatus, "keeperhub", idempotencyKey),
      };
    } catch (error) {
      return {
        type: "failed",
        event: this.buildFailedEvent(input, planned, undefined, idempotencyKey, error),
      };
    }
  }

  private planTrade(input: ExecuteTradeInput): PlannedTrade | null {
    const [base, quote] = input.tokenPair.split("/");
    const baseToken = base ?? "WETH";
    const quoteToken = quote ?? "USDC";
    const maxTradeUsd = input.startingCapitalUsd * 0.5;

    if (input.action === "buy") {
      const amountUsd = Math.min(input.signalAmount, input.usdcBalance, maxTradeUsd);
      if (amountUsd < 10) return null;

      const ethBought = amountUsd / input.currentPrice;
      return {
        action: "buy",
        baseToken,
        quoteToken,
        tokenInSymbol: quoteToken,
        tokenOutSymbol: baseToken,
        amountInHuman: amountUsd,
        sold: { token: quoteToken, amount: Number(amountUsd.toFixed(2)) },
        expectedBought: { token: baseToken, amount: Number(ethBought.toFixed(6)) },
        usdcDelta: -amountUsd,
        ethDelta: ethBought,
      };
    }

    let amountEth = Math.min(input.signalAmount, input.ethBalance);
    if (amountEth < 10 / input.currentPrice) return null;

    const amountUsd = amountEth * input.currentPrice;
    if (amountUsd > maxTradeUsd) {
      amountEth = maxTradeUsd / input.currentPrice;
    }

    const quoteReceived = amountEth * input.currentPrice;
    return {
      action: "sell",
      baseToken,
      quoteToken,
      tokenInSymbol: baseToken,
      tokenOutSymbol: quoteToken,
      amountInHuman: amountEth,
      sold: { token: baseToken, amount: Number(amountEth.toFixed(6)) },
      expectedBought: { token: quoteToken, amount: Number(quoteReceived.toFixed(2)) },
      usdcDelta: quoteReceived,
      ethDelta: -amountEth,
    };
  }

  private async executeApprovalIfNeeded(
    quote: SwapQuoteResult,
    swap: SwapBuildResult,
    idempotencyKey: string,
  ): Promise<void> {
    if (quote.tokenIn === "0x0000000000000000000000000000000000000000") return;

    const approval = await this.uniswap?.checkApproval(quote).catch(() => undefined);
    const spender = approval?.spender ?? swap.spender;
    const approvalNeeded = approval?.approvalNeeded ?? Boolean(spender);
    if (!spender || !approvalNeeded) return;

    const submitted = await this.keeperhub?.executeErc20Approval({
      tokenAddress: quote.tokenIn,
      spenderAddress: spender,
      amountBaseUnits: quote.amountIn,
      idempotencyKey: `${idempotencyKey}:approval`,
    });
    if (!submitted || submitted.status === "failed") {
      throw new AppError("KEEPERHUB_EXECUTION_FAILED", "KeeperHub approval execution failed", {
        statusCode: 502,
        details: submitted ? { executionId: submitted.executionId, status: submitted.status } : undefined,
      });
    }

    const finalStatus = await this.keeperhub?.waitForCompletion(submitted);
    if (!finalStatus || finalStatus.status !== "completed") {
      throw new AppError("KEEPERHUB_EXECUTION_FAILED", "KeeperHub approval did not complete", {
        statusCode: 502,
        details: finalStatus ? { executionId: finalStatus.executionId, status: finalStatus.status } : undefined,
      });
    }
  }

  private requireKeeperCompatibleSwapCall(swap: SwapBuildResult): KeeperCompatibleContractCall {
    if (swap.contractCall) {
      return swap.contractCall;
    }

    throw new AppError(
      "UNISWAP_SWAP_UNSUPPORTED",
      "Uniswap swap response did not include a KeeperHub contract-call representation",
      {
        statusCode: 502,
        details: {
          hasTransaction: Boolean(swap.transaction),
          transactionTo: swap.transaction?.to,
          note: "KeeperHub Direct Execution docs expose contract-call, not raw calldata execution.",
        },
      },
    );
  }

  private simulateExecution(
    input: ExecuteTradeInput,
    planned: PlannedTrade,
    idempotencyKey: string,
  ): ExecuteTradeOutcome {
    const transactionHash = `0x${randomUUID().replace(/-/g, "").slice(0, 32)}`;
    return {
      type: "executed",
      usdcDelta: planned.usdcDelta,
      ethDelta: planned.ethDelta,
      event: {
        event: "trade_executed",
        contender: input.contender,
        txHash: transactionHash,
        sold: planned.sold,
        bought: planned.expectedBought,
        gasUsd: Number((Math.random() * 1.5 + 0.8).toFixed(2)),
        timestamp: new Date().toISOString(),
        executionProvider: "simulated",
        executionStatus: "completed",
        transactionHash,
        idempotencyKey,
      },
    };
  }

  private buildSubmittedEvent(
    input: ExecuteTradeInput,
    planned: PlannedTrade,
    status: KeeperHubExecutionStatus,
    idempotencyKey: string,
  ): TradeSubmittedEvent {
    return {
      event: "trade_submitted",
      contender: input.contender,
      action: input.action,
      sold: planned.sold,
      expectedBought: planned.expectedBought,
      timestamp: new Date().toISOString(),
      executionProvider: "keeperhub",
      executionStatus: status.status === "failed" ? "submitted" : status.status,
      keeperExecutionId: status.executionId,
      idempotencyKey,
    };
  }

  private buildExecutedEvent(
    input: ExecuteTradeInput,
    planned: PlannedTrade,
    status: KeeperHubExecutionStatus,
    provider: ExecutionProvider,
    idempotencyKey: string,
  ): TradeEvent {
    const transactionHash = status.transactionHash ?? `keeperhub:${status.executionId}`;
    return {
      event: "trade_executed",
      contender: input.contender,
      txHash: transactionHash,
      sold: planned.sold,
      bought: planned.expectedBought,
      gasUsd: 0,
      timestamp: new Date().toISOString(),
      executionProvider: provider,
      executionStatus: "completed",
      keeperExecutionId: status.executionId,
      transactionHash,
      ...(status.transactionLink ? { transactionLink: status.transactionLink } : {}),
      ...(status.gasUsedWei ? { gasUsedWei: status.gasUsedWei } : {}),
      idempotencyKey,
    };
  }

  private buildFailedEvent(
    input: ExecuteTradeInput,
    planned: PlannedTrade,
    status: KeeperHubExecutionStatus | undefined,
    idempotencyKey: string,
    error?: unknown,
  ): TradeFailedEvent {
    return {
      event: "trade_failed",
      contender: input.contender,
      action: input.action,
      sold: planned.sold,
      expectedBought: planned.expectedBought,
      txHash: status?.transactionHash,
      timestamp: new Date().toISOString(),
      executionProvider: "keeperhub",
      executionStatus: "failed",
      keeperExecutionId: status?.executionId,
      transactionHash: status?.transactionHash,
      transactionLink: status?.transactionLink,
      gasUsedWei: status?.gasUsedWei,
      executionError: error
        ? toExecutionError(error)
        : { code: "KEEPERHUB_EXECUTION_FAILED", message: "KeeperHub execution failed" },
      idempotencyKey,
    };
  }

  private buildIdempotencyKey(input: ExecuteTradeInput, planned: PlannedTrade): string {
    return [
      "chain-slam",
      input.matchId,
      input.contender.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
      input.tickNumber,
      input.action,
      planned.sold.token,
      planned.sold.amount,
    ].join(":");
  }
}
