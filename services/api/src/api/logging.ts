export type ApiRequestLog = Readonly<{
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}>;

/**
 * Structured server-side record of an unexpected error. The full message is
 * kept here (server logs only) while the client response is redacted, so
 * operators can still diagnose 500s without leaking internals on the wire.
 */
export type ApiErrorLog = Readonly<{
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  error: string;
}>;

/**
 * Sink for one structured line per handled request. Kept intentionally narrow
 * so tests can inject a capturing logger and production can emit JSON.
 * `logError` is optional so existing loggers stay compatible.
 */
export type ApiLogger = Readonly<{
  logRequest(entry: ApiRequestLog): void;
  logError?(entry: ApiErrorLog): void;
}>;

export const noopApiLogger: ApiLogger = {
  logRequest() {
    // Intentionally does nothing; used by tests and silent embedding.
  },
  logError() {
    // Intentionally does nothing; used by tests and silent embedding.
  },
};

export function createJsonApiLogger(
  write: (line: string) => void = console.log,
  writeError: (line: string) => void = console.error,
): ApiLogger {
  return {
    logRequest(entry) {
      write(
        JSON.stringify({
          level: "info",
          type: "api.request",
          timestamp: new Date().toISOString(),
          ...entry,
        }),
      );
    },
    logError(entry) {
      writeError(
        JSON.stringify({
          level: "error",
          type: "api.error",
          timestamp: new Date().toISOString(),
          ...entry,
        }),
      );
    },
  };
}
