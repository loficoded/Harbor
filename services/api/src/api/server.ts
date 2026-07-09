import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import {
  normalizeRequestId,
  serializeBigints,
  type IsoTimestamp,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import type { ApiServerConfig } from "./config.js";
import { buildCorsHeaders } from "./cors.js";
import { ApiError, toApiError, toApiErrorResponse } from "./errors.js";
import { createJsonApiLogger, type ApiLogger } from "./logging.js";
import {
  buildAgentsResponseData,
  buildHealthReport,
  buildRedemptionResponseData,
} from "./queries.js";

export type ApiServerDependencies = Readonly<{
  database: SqliteDatabase;
  config: ApiServerConfig;
  logger?: ApiLogger;
  now?: () => IsoTimestamp;
  generateRequestId?: () => string;
}>;

type RouteResult = Readonly<{
  statusCode: number;
  body: unknown;
}>;

const redemptionPathPattern = /^\/redemptions\/([^/]+)$/;

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function requestOrigin(request: IncomingMessage): string | null {
  return headerString(request.headers.origin);
}

/**
 * Create the Harbor API HTTP server. The database, config, logger, clock, and
 * request-id generator are all injected, so tests can drive the exact same
 * server against a temporary SQLite database on an ephemeral port.
 */
export function createApiServer(deps: ApiServerDependencies): Server {
  const { database, config } = deps;
  const logger = deps.logger ?? createJsonApiLogger();
  const generateRequestId = deps.generateRequestId ?? (() => randomUUID());
  const clock = deps.now;

  function route(url: URL): RouteResult {
    const { pathname } = url;

    if (pathname === "/health") {
      const report = buildHealthReport(
        database,
        config,
        clock === undefined ? {} : { now: clock() },
      );

      return {
        statusCode: report.status === "ok" ? 200 : 503,
        body: report,
      };
    }

    if (pathname === "/agents") {
      const assetParam = url.searchParams.get("asset");
      const asset = (assetParam ?? config.defaultAsset).trim().toUpperCase();

      if (!config.supportedAssets.includes(asset)) {
        throw ApiError.badRequest(
          `Unsupported asset "${assetParam ?? asset}". Supported assets: ${config.supportedAssets.join(", ")}`,
          {
            asset: assetParam,
            supportedAssets: config.supportedAssets,
          },
        );
      }

      return {
        statusCode: 200,
        body: buildAgentsResponseData(database, asset),
      };
    }

    const redemptionMatch = redemptionPathPattern.exec(pathname);

    if (redemptionMatch !== null) {
      const rawId = decodeURIComponent(redemptionMatch[1] ?? "");
      let normalizedId: string;

      try {
        normalizedId = normalizeRequestId(rawId);
      } catch {
        throw ApiError.notFound(`Redemption "${rawId}" was not found`);
      }

      const data = buildRedemptionResponseData(database, normalizedId);

      if (data === null) {
        throw ApiError.notFound(`Redemption "${rawId}" was not found`);
      }

      return { statusCode: 200, body: data };
    }

    throw ApiError.notFound(`Route ${pathname} was not found`);
  }

  return createServer((request, response) => {
    const requestId = generateRequestId();
    const startedAt = process.hrtime.bigint();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const corsHeaders = buildCorsHeaders(config.cors, requestOrigin(request));

    response.setHeader("x-request-id", requestId);

    for (const [name, value] of Object.entries(corsHeaders)) {
      response.setHeader(name, value);
    }

    const logRequest = (statusCode: number): void => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.logRequest({
        requestId,
        method,
        path: url.pathname,
        statusCode,
        durationMs,
      });
    };

    const sendJson = (statusCode: number, body: unknown): void => {
      response.statusCode = statusCode;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(serializeBigints(body)));
      logRequest(statusCode);
    };

    try {
      // CORS preflight: answer with the negotiated headers and no body.
      if (method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        logRequest(204);
        return;
      }

      if (method !== "GET") {
        throw ApiError.methodNotAllowed(
          `Method ${method} is not supported; use GET`,
        );
      }

      const result = route(url);
      sendJson(result.statusCode, result.body);
    } catch (error) {
      const apiError = toApiError(error);
      sendJson(apiError.statusCode, toApiErrorResponse(apiError, requestId));
    }
  });
}
