import type { ApiErrorResponse, JsonValue } from "@harbor/shared";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "TOO_MANY_REQUESTS"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

/**
 * Client-facing message used for any unexpected (`INTERNAL`) error. The real
 * error message is logged server-side but never returned to the caller, so
 * internal details (stack messages, database paths, driver errors) cannot leak.
 */
export const internalErrorMessage = "Internal server error";

/**
 * Error carrying the HTTP status and machine-readable code used to build a
 * consistent JSON error body. Handlers throw these; the server serializes them.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: JsonValue | null;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details: JsonValue | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(
    message: string,
    details: JsonValue | null = null,
  ): ApiError {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static notFound(message: string, details: JsonValue | null = null): ApiError {
    return new ApiError(404, "NOT_FOUND", message, details);
  }

  static methodNotAllowed(
    message: string,
    details: JsonValue | null = null,
  ): ApiError {
    return new ApiError(405, "METHOD_NOT_ALLOWED", message, details);
  }

  static tooManyRequests(
    message: string,
    details: JsonValue | null = null,
  ): ApiError {
    return new ApiError(429, "TOO_MANY_REQUESTS", message, details);
  }

  static serviceUnavailable(
    message: string,
    details: JsonValue | null = null,
  ): ApiError {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message, details);
  }

  static internal(message: string, details: JsonValue | null = null): ApiError {
    return new ApiError(500, "INTERNAL", message, details);
  }
}

/** Coerce any thrown value into an ApiError, defaulting to a 500. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return ApiError.internal(message);
}

/**
 * Serialize an {@link ApiError} into the on-wire body. Intentional 4xx/503
 * messages and details are surfaced as-is (they are safe, caller-facing text),
 * but an unexpected `INTERNAL` error is redacted to a generic message with no
 * details so server internals never leak to clients.
 */
export function toApiErrorResponse(
  error: ApiError,
  requestId: string,
): ApiErrorResponse {
  const isInternal = error.code === "INTERNAL";

  return {
    error: {
      code: error.code,
      message: isInternal ? internalErrorMessage : error.message,
      requestId,
      details: isInternal ? null : error.details,
    },
  };
}
