import type { CorsConfig } from "./config.js";

/**
 * Decide the value for `Access-Control-Allow-Origin`:
 * - `"*"` when the config allows any origin,
 * - the request's own origin when it is on the allow-list (so credentials and
 *   specific origins work), or
 * - `null` when the origin is absent or not allowed (no CORS header emitted).
 */
export function resolveCorsAllowOrigin(
  config: CorsConfig,
  requestOrigin: string | null,
): string | null {
  if (config.allowedOrigins.includes("*")) {
    return "*";
  }

  if (requestOrigin !== null && config.allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

/**
 * Build the CORS response headers for a request. Method/header/max-age hints are
 * always returned; the origin header is only present when the origin is allowed,
 * and `Vary: Origin` is added when the response depends on the request origin.
 */
export function buildCorsHeaders(
  config: CorsConfig,
  requestOrigin: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": config.allowedMethods.join(", "),
    "access-control-allow-headers": config.allowedHeaders.join(", "),
    "access-control-max-age": String(config.maxAgeSeconds),
  };

  const allowOrigin = resolveCorsAllowOrigin(config, requestOrigin);

  if (allowOrigin === null) {
    return headers;
  }

  headers["access-control-allow-origin"] = allowOrigin;

  if (allowOrigin !== "*") {
    headers["vary"] = "Origin";
  }

  return headers;
}
