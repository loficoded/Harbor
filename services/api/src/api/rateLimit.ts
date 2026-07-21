import type { IncomingMessage } from "node:http";

/**
 * Fixed-window per-client rate limiting for the public read API. This is
 * defense-in-depth against request floods; the API is read-only, so the goal is
 * to bound per-client throughput, not to gate authorization.
 */
export type RateLimitConfig = Readonly<{
  /** When false, the limiter is a no-op (every request is allowed). */
  enabled: boolean;
  /** Max requests permitted per client within a window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Whether to trust `X-Forwarded-For` for the client identity. Enable behind a
   * trusted reverse proxy (e.g. Railway) so limiting is per-client rather than
   * per-proxy. When no trusted proxy sits in front, a client can spoof the
   * header, so the limiter degrades to fail-open (never wrongly blocks others)
   * rather than fail-closed.
   */
  trustProxy: boolean;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the current window resets. */
  retryAfterMs: number;
}>;

export const defaultRateLimit = 120;
export const defaultRateLimitWindowMs = 60_000;

/** Cap on tracked client keys before stale entries are pruned, bounding memory. */
const maxTrackedClients = 50_000;

type WindowState = { windowStartMs: number; count: number };

/**
 * In-memory fixed-window counter keyed by an opaque client identity. One
 * instance is created per API server process; state is intentionally local (not
 * shared) so tests get a clean limiter per server and a restart resets counts.
 */
export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clients = new Map<string, WindowState>();

  constructor(options: Readonly<{ limit: number; windowMs: number }>) {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new Error("rate limit must be a positive integer");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new Error("rate limit window must be a positive integer");
    }

    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  /** Record a hit for `key` at `nowMs` and decide whether it is allowed. */
  check(key: string, nowMs: number = Date.now()): RateLimitDecision {
    const existing = this.clients.get(key);

    if (
      existing === undefined ||
      nowMs - existing.windowStartMs >= this.windowMs
    ) {
      if (this.clients.size >= maxTrackedClients) {
        this.prune(nowMs);
      }

      this.clients.set(key, { windowStartMs: nowMs, count: 1 });
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - 1,
        retryAfterMs: this.windowMs,
      };
    }

    existing.count += 1;
    const retryAfterMs = Math.max(
      0,
      existing.windowStartMs + this.windowMs - nowMs,
    );

    if (existing.count > this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        retryAfterMs,
      };
    }

    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - existing.count,
      retryAfterMs,
    };
  }

  /** Drop entries whose window has fully elapsed, bounding memory growth. */
  private prune(nowMs: number): void {
    for (const [key, state] of this.clients) {
      if (nowMs - state.windowStartMs >= this.windowMs) {
        this.clients.delete(key);
      }
    }

    // If every tracked client is still within its window, clear the map wholesale
    // rather than growing without bound. Fixed-window limiting tolerates this
    // reset: the worst case is one extra window of allowance for active clients.
    if (this.clients.size >= maxTrackedClients) {
      this.clients.clear();
    }
  }
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

/**
 * Resolve an opaque client identity for rate limiting. Behind a trusted proxy,
 * the left-most `X-Forwarded-For` entry (the originating client) is used;
 * otherwise the transport socket address is used. Falls back to a constant
 * bucket only when no identity is available at all.
 */
export function resolveClientKey(
  request: IncomingMessage,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwardedFor = headerString(request.headers["x-forwarded-for"]);
    const clientIp = forwardedFor?.split(",")[0]?.trim();

    if (clientIp !== undefined && clientIp !== "") {
      return clientIp;
    }
  }

  return request.socket.remoteAddress ?? "unknown";
}
