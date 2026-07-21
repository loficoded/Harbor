import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, test } from "node:test";

import { resolveRateLimitConfig } from "./config.js";
import {
  FixedWindowRateLimiter,
  defaultRateLimit,
  defaultRateLimitWindowMs,
  resolveClientKey,
} from "./rateLimit.js";

describe("FixedWindowRateLimiter", () => {
  test("allows requests up to the limit and blocks the next one in the window", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 3, windowMs: 1_000 });

    assert.equal(limiter.check("a", 0).allowed, true);
    assert.equal(limiter.check("a", 10).allowed, true);
    assert.equal(limiter.check("a", 20).allowed, true);

    const blocked = limiter.check("a", 30);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.limit, 3);
    assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 1_000);
  });

  test("reports a decreasing remaining count", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 5, windowMs: 1_000 });

    assert.equal(limiter.check("a", 0).remaining, 4);
    assert.equal(limiter.check("a", 1).remaining, 3);
    assert.equal(limiter.check("a", 2).remaining, 2);
  });

  test("resets allowance after the window elapses", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });

    assert.equal(limiter.check("a", 0).allowed, true);
    assert.equal(limiter.check("a", 100).allowed, true);
    assert.equal(limiter.check("a", 200).allowed, false);

    // A hit at/after the window boundary starts a fresh window.
    assert.equal(limiter.check("a", 1_000).allowed, true);
    assert.equal(limiter.check("a", 1_100).allowed, true);
    assert.equal(limiter.check("a", 1_200).allowed, false);
  });

  test("tracks distinct client keys independently", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });

    assert.equal(limiter.check("a", 0).allowed, true);
    assert.equal(limiter.check("a", 1).allowed, false);
    // A different client is unaffected by the first client's usage.
    assert.equal(limiter.check("b", 1).allowed, true);
  });

  test("rejects a non-positive limit or window", () => {
    assert.throws(
      () => new FixedWindowRateLimiter({ limit: 0, windowMs: 1_000 }),
      /rate limit must be a positive integer/,
    );
    assert.throws(
      () => new FixedWindowRateLimiter({ limit: 5, windowMs: 0 }),
      /rate limit window must be a positive integer/,
    );
  });
});

describe("resolveClientKey", () => {
  function fakeRequest(
    headers: Record<string, string | string[] | undefined>,
    remoteAddress: string | undefined,
  ): IncomingMessage {
    return {
      headers,
      socket: { remoteAddress },
    } as unknown as IncomingMessage;
  }

  test("uses the first X-Forwarded-For entry when the proxy is trusted", () => {
    const request = fakeRequest(
      { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      "10.0.0.1",
    );
    assert.equal(resolveClientKey(request, true), "203.0.113.7");
  });

  test("ignores X-Forwarded-For when the proxy is not trusted", () => {
    const request = fakeRequest(
      { "x-forwarded-for": "203.0.113.7" },
      "198.51.100.9",
    );
    assert.equal(resolveClientKey(request, false), "198.51.100.9");
  });

  test("falls back to the socket address, then a constant bucket", () => {
    assert.equal(
      resolveClientKey(fakeRequest({}, "198.51.100.9"), true),
      "198.51.100.9",
    );
    assert.equal(resolveClientKey(fakeRequest({}, undefined), true), "unknown");
  });
});

describe("resolveRateLimitConfig", () => {
  test("is enabled with sane defaults", () => {
    assert.deepEqual(resolveRateLimitConfig({}), {
      enabled: true,
      limit: defaultRateLimit,
      windowMs: defaultRateLimitWindowMs,
      trustProxy: true,
    });
  });

  test("honors explicit overrides", () => {
    assert.deepEqual(
      resolveRateLimitConfig({
        HARBOR_API_RATE_LIMIT_ENABLED: "false",
        HARBOR_API_RATE_LIMIT: "10",
        HARBOR_API_RATE_LIMIT_WINDOW_MS: "5000",
        HARBOR_API_TRUST_PROXY: "false",
      }),
      { enabled: false, limit: 10, windowMs: 5_000, trustProxy: false },
    );
  });

  test("rejects a non-positive limit", () => {
    assert.throws(
      () => resolveRateLimitConfig({ HARBOR_API_RATE_LIMIT: "0" }),
      /must be a positive integer/,
    );
  });
});
