export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "MATCH_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "AGENT_NOT_AVAILABLE"
  | "AGENT_CREATE_FAILED"
  | "UNISWAP_QUOTE_FAILED"
  | "UNISWAP_SWAP_BUILD_FAILED"
  | "UNISWAP_SWAP_UNSUPPORTED"
  | "KEEPERHUB_CONFIG_MISSING"
  | "KEEPERHUB_AUTH_FAILED"
  | "KEEPERHUB_RATE_LIMITED"
  | "KEEPERHUB_REQUEST_FAILED"
  | "KEEPERHUB_EXECUTION_FAILED"
  | "KEEPERHUB_EXECUTION_TIMEOUT"
  | "EXECUTION_SKIPPED"
  | "INTERNAL_ERROR";

export interface ErrorEnvelope {
  error: {
    code: AppErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { statusCode?: number; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorEnvelope(error: AppError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId,
    },
  };
}

export function toExecutionError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }

  return { code: "INTERNAL_ERROR", message: "Unknown execution error" };
}
