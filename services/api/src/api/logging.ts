export type ApiRequestLog = Readonly<{
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}>;

/**
 * Sink for one structured line per handled request. Kept intentionally narrow
 * so tests can inject a capturing logger and production can emit JSON.
 */
export type ApiLogger = Readonly<{
  logRequest(entry: ApiRequestLog): void;
}>;

export const noopApiLogger: ApiLogger = {
  logRequest() {
    // Intentionally does nothing; used by tests and silent embedding.
  },
};

export function createJsonApiLogger(
  write: (line: string) => void = console.log,
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
  };
}
