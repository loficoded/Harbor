import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  securityHeaders,
} from "../../security-headers.mjs";

function headerValue(key: string): string | undefined {
  return securityHeaders.find((header) => header.key === key)?.value;
}

describe("security headers", () => {
  it("locks down the high-value CSP directives", () => {
    const csp = buildContentSecurityPolicy();

    // Clickjacking and injection surface are shut off outright.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("stays permissive enough for a wagmi / WalletConnect dapp", () => {
    const csp = buildContentSecurityPolicy();

    // Wallets/RPC over arbitrary https/wss, agent icons over https.
    expect(csp).toContain("connect-src 'self' https: wss:");
    expect(csp).toContain("img-src 'self' data: https:");
  });

  it("emits the CSP as a response header", () => {
    expect(headerValue("Content-Security-Policy")).toBe(
      buildContentSecurityPolicy(),
    );
  });

  it("sets the complementary hardening headers", () => {
    expect(headerValue("X-Frame-Options")).toBe("DENY");
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headerValue("Strict-Transport-Security")).toContain(
      "includeSubDomains",
    );
    expect(headerValue("Permissions-Policy")).toContain("geolocation=()");
  });
});
