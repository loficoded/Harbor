import type { ApiErrorResponse, JsonValue } from "@harbor/shared";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

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

export function toApiErrorResponse(
  error: ApiError,
  requestId: string,
): ApiErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    },
  };
}
