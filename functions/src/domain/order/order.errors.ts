export type ErrorCode =
  | "INVALID_ORDER"
  | "INVALID_CUSTOMER"
  | "CUSTOMER_NOT_FOUND"
  | "DUPLICATE_ORDER"
  | "EXTERNAL_CUSTOMER_ALREADY_EXISTS"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR"
  | "SHOPLINE_NOT_ENABLED"
  | "DEV_ADMIN_DISABLED";

const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_ORDER: 400,
  INVALID_CUSTOMER: 400,
  CUSTOMER_NOT_FOUND: 404,
  DUPLICATE_ORDER: 409,
  EXTERNAL_CUSTOMER_ALREADY_EXISTS: 409,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
  SHOPLINE_NOT_ENABLED: 501,
  DEV_ADMIN_DISABLED: 404
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
