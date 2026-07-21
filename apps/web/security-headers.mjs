// Security response headers applied to every route by next.config.mjs.
//
// Single source of truth so the values are unit-testable (see
// src/lib/security-headers.test.ts) and cannot silently drift from the config.
//
// The Content-Security-Policy is deliberately strict on the directives that
// stop injection and clickjacking outright — `frame-ancestors 'none'`,
// `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — while staying
// permissive enough on resource loading that a wagmi / WalletConnect dapp keeps
// working: wallets and RPC talk over arbitrary https/wss (`connect-src`), agent
// icons come from arbitrary https origins (`img-src`), and Next's hydration
// bootstrap needs inline scripts. Tightening `script-src` further (nonces via
// middleware, dropping 'unsafe-inline'/'unsafe-eval') is a recommended
// follow-up and should be validated in staging before shipping.

/** Ordered CSP directives. Exported so tests can assert individual entries. */
export const contentSecurityPolicyDirectives = [
  ["default-src", ["'self'"]],
  ["base-uri", ["'self'"]],
  ["object-src", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["form-action", ["'self'"]],
  ["script-src", ["'self'", "'unsafe-inline'", "'unsafe-eval'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", "data:", "https:"]],
  ["font-src", ["'self'", "data:"]],
  // Wallets (WalletConnect relays), RPC, and the Harbor read API are reached
  // over arbitrary https/wss endpoints configured at runtime.
  ["connect-src", ["'self'", "https:", "wss:"]],
  // WalletConnect / Web3Modal render their UI in-page but may embed https frames.
  ["frame-src", ["'self'", "https:"]],
  ["worker-src", ["'self'", "blob:"]],
  ["manifest-src", ["'self'"]],
  ["upgrade-insecure-requests", []],
];

/** Build the CSP header string from {@link contentSecurityPolicyDirectives}. */
export function buildContentSecurityPolicy() {
  return contentSecurityPolicyDirectives
    .map(([directive, values]) =>
      values.length === 0 ? directive : `${directive} ${values.join(" ")}`,
    )
    .join("; ");
}

/**
 * The full set of security headers. `frame-ancestors 'none'` (CSP) plus the
 * legacy `X-Frame-Options: DENY` both block clickjacking; HSTS forces https;
 * `nosniff` stops MIME confusion; a locked-down `Permissions-Policy` disables
 * powerful features the dapp never uses.
 */
export const securityHeaders = [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];
