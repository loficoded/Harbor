import { coston2Chain, coston2FxrpAssetManagerAddress } from "@harbor/protocol";
import {
  normalizeEvmAddress,
  type EnvInput,
  type EvmAddress,
  type HealthBuildInfo,
} from "@harbor/shared";

import {
  defaultRateLimit,
  defaultRateLimitWindowMs,
  type RateLimitConfig,
} from "./rateLimit.js";

export const harborApiServiceName = "@harbor/api";
export const harborApiVersion = "0.1.0";
export const defaultHarborApiPort = 3001;
export const defaultAssetSymbol = "FXRP";

/**
 * Origins allowed by default so a locally running Next.js dev server (Prompt
 * #16) can call the API from the browser without extra configuration.
 */
export const defaultLocalCorsOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export type CorsConfig = Readonly<{
  allowedOrigins: readonly string[];
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
  maxAgeSeconds: number;
}>;

export type ApiServerConfig = Readonly<{
  chainId: string;
  assetManagerAddress: EvmAddress;
  supportedAssets: readonly string[];
  defaultAsset: string;
  cors: CorsConfig;
  rateLimit: RateLimitConfig;
  build: HealthBuildInfo;
}>;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next === undefined || next === "" ? undefined : next;
}

function parseOrigins(value: string | undefined): readonly string[] | null {
  const raw = trimmed(value);

  if (raw === undefined) {
    return null;
  }

  if (raw === "*") {
    return ["*"];
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : null;
}

export function resolveCorsConfig(env: EnvInput = process.env): CorsConfig {
  return {
    allowedOrigins: parseOrigins(env["HARBOR_API_CORS_ORIGINS"]) ?? [
      ...defaultLocalCorsOrigins,
    ],
    allowedMethods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAgeSeconds: 86_400,
  };
}

const truthyFlagValues = new Set(["1", "true", "yes", "on"]);
const falsyFlagValues = new Set(["0", "false", "no", "off"]);

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  const raw = trimmed(value)?.toLowerCase();

  if (raw === undefined) {
    return defaultValue;
  }

  if (truthyFlagValues.has(raw)) {
    return true;
  }

  if (falsyFlagValues.has(raw)) {
    return false;
  }

  throw new Error(`Expected a boolean value (true/false), received "${value}"`);
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const raw = trimmed(value);

  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }

  return parsed;
}

/**
 * Resolve public-API rate limiting. Enabled by default as request-flood
 * defense-in-depth; `trustProxy` defaults on so per-client limiting is correct
 * behind the platform proxy (Railway). All knobs are overridable via env.
 */
export function resolveRateLimitConfig(
  env: EnvInput = process.env,
): RateLimitConfig {
  return {
    enabled: parseBooleanFlag(env["HARBOR_API_RATE_LIMIT_ENABLED"], true),
    limit: parsePositiveIntegerEnv(
      env["HARBOR_API_RATE_LIMIT"],
      defaultRateLimit,
      "HARBOR_API_RATE_LIMIT",
    ),
    windowMs: parsePositiveIntegerEnv(
      env["HARBOR_API_RATE_LIMIT_WINDOW_MS"],
      defaultRateLimitWindowMs,
      "HARBOR_API_RATE_LIMIT_WINDOW_MS",
    ),
    trustProxy: parseBooleanFlag(env["HARBOR_API_TRUST_PROXY"], true),
  };
}

export function resolveBuildInfo(env: EnvInput = process.env): HealthBuildInfo {
  return {
    service: harborApiServiceName,
    version: trimmed(env["HARBOR_BUILD_VERSION"]) ?? harborApiVersion,
    environment: trimmed(env["HARBOR_ENV"]) ?? "development",
    gitCommit: trimmed(env["HARBOR_BUILD_COMMIT"]) ?? null,
  };
}

export function resolveAssetManagerAddress(
  env: EnvInput = process.env,
): EvmAddress {
  return normalizeEvmAddress(
    trimmed(env["HARBOR_ASSET_MANAGER_ADDRESS"]) ??
      coston2FxrpAssetManagerAddress,
  );
}

export function resolveApiServerConfig(
  env: EnvInput = process.env,
): ApiServerConfig {
  return {
    chainId: String(coston2Chain.id),
    assetManagerAddress: resolveAssetManagerAddress(env),
    supportedAssets: [defaultAssetSymbol],
    defaultAsset: defaultAssetSymbol,
    cors: resolveCorsConfig(env),
    rateLimit: resolveRateLimitConfig(env),
    build: resolveBuildInfo(env),
  };
}

export function resolveApiPort(env: EnvInput = process.env): number {
  const raw = trimmed(env["HARBOR_API_PORT"]);

  if (raw === undefined) {
    return defaultHarborApiPort;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(
      `HARBOR_API_PORT must be an integer between 0 and 65535, received "${raw}"`,
    );
  }

  return parsed;
}
