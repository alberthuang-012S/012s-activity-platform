export type ErrorCode =
  | "INVALID_ORDER"
  | "INVALID_CUSTOMER"
  | "CUSTOMER_NOT_FOUND"
  | "DUPLICATE_ORDER"
  | "EXTERNAL_CUSTOMER_ALREADY_EXISTS"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR"
  | "SHOPLINE_NOT_ENABLED"
  | "DEV_ADMIN_DISABLED"
  | "INVALID_CAMPAIGN"
  | "INVALID_ACTIVITY_RULE"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_NOT_ACTIVE"
  | "CAMPAIGN_OVERLAP"
  | "CAMPAIGN_IMMUTABLE"
  | "ACTIVITY_PROCESSING_FAILED"
  | "ACTIVITY_ALREADY_PROCESSED"
  | "WALLET_NOT_FOUND"
  | "INVALID_WALLET_BALANCE"
  | "SLOT_SPIN_EXHAUSTED"
  | "INVALID_SESSION"
  | "SESSION_EXPIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "CORS_ORIGIN_NOT_ALLOWED"
  | "ORDER_NOT_FOUND";

const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_ORDER: 400,
  INVALID_CUSTOMER: 400,
  CUSTOMER_NOT_FOUND: 404,
  DUPLICATE_ORDER: 409,
  EXTERNAL_CUSTOMER_ALREADY_EXISTS: 409,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
  SHOPLINE_NOT_ENABLED: 501,
  DEV_ADMIN_DISABLED: 404,
  INVALID_CAMPAIGN: 400,
  INVALID_ACTIVITY_RULE: 400,
  CAMPAIGN_NOT_FOUND: 404,
  CAMPAIGN_NOT_ACTIVE: 409,
  CAMPAIGN_OVERLAP: 409,
  CAMPAIGN_IMMUTABLE: 409,
  ACTIVITY_PROCESSING_FAILED: 500,
  ACTIVITY_ALREADY_PROCESSED: 409,
  WALLET_NOT_FOUND: 404,
  INVALID_WALLET_BALANCE: 500,
  SLOT_SPIN_EXHAUSTED: 409,
  INVALID_SESSION: 401,
  SESSION_EXPIRED: 401,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  CORS_ORIGIN_NOT_ALLOWED: 403,
  ORDER_NOT_FOUND: 404
};

export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = DEFAULT_STATUS_BY_CODE[code],
    cause?: unknown
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export function toApplicationError(
  error: unknown,
  fallbackCode: ErrorCode = "INTERNAL_ERROR"
): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApplicationError(fallbackCode, error.message, undefined, error);
  }

  return new ApplicationError(fallbackCode, "An unexpected error occurred.", undefined, error);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(DEFAULT_STATUS_BY_CODE, value);
}
