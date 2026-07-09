import {
  createHarborApiClient,
  HarborApiClient,
  HarborApiError,
  normalizeBaseUrl,
} from "@/lib/api-client";
import { DEFAULT_HARBOR_API_BASE_URL } from "@/lib/env";
import { describe, expect, it, vi } from "vitest";

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("normalizeBaseUrl", () => {
  it("trims whitespace and strips trailing slashes", () => {
    expect(normalizeBaseUrl("  http://localhost:3001/  ")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeBaseUrl("http://localhost:3001///")).toBe(
      "http://localhost:3001",
    );
  });

  it("throws on an empty base url", () => {
    expect(() => normalizeBaseUrl("   ")).toThrow();
  });
});

describe("HarborApiClient base URL handling", () => {
  it("joins paths against the normalized base url", () => {
    const client = new HarborApiClient({
      baseUrl: "http://localhost:3001/",
      fetchImpl: async () => jsonResponse({}),
    });

    expect(client.target).toBe("http://localhost:3001");
    expect(client.buildUrl("/health")).toBe("http://localhost:3001/health");
    expect(client.buildUrl("agents", { asset: "FXRP" })).toBe(
      "http://localhost:3001/agents?asset=FXRP",
    );
  });

  it("requests the expected agents URL with a query string", async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      return jsonResponse({
        asset: "FXRP",
        scoreIsHeuristic: true,
        agents: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const client = new HarborApiClient({
      baseUrl: "https://api.harbor.example",
      fetchImpl,
    });
    await client.getAgents("FXRP");

    expect(requested[0]).toBe("https://api.harbor.example/agents?asset=FXRP");
  });

  it("throws a HarborApiError carrying the parsed error body", async () => {
    const fetchImpl = async () =>
      jsonResponse(
        {
          error: {
            code: "not_found",
            message: 'Redemption "x" was not found',
            requestId: "req-1",
            details: null,
          },
        },
        { status: 404, headers: { "x-request-id": "req-1" } },
      );

    const client = new HarborApiClient({
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    await expect(client.getRedemption("x")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      requestId: "req-1",
    });
    await expect(client.getRedemption("x")).rejects.toBeInstanceOf(
      HarborApiError,
    );
  });

  it("defaults to the mock-mode base URL when none is provided", () => {
    const client = createHarborApiClient();

    expect(client.target).toBe(DEFAULT_HARBOR_API_BASE_URL);
  });
});
