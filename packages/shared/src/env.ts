import {
  normalizeEvmAddress,
  type EvmAddress,
  type HexString,
} from "./normalize.js";

export type EnvInput = Readonly<Record<string, string | undefined>>;

export type EnvValidationIssue = Readonly<{
  name: string;
  message: string;
}>;

export class EnvValidationError extends Error {
  readonly issues: readonly EnvValidationIssue[];

  constructor(issues: readonly EnvValidationIssue[]) {
    super(
      `Invalid environment: ${issues
        .map((issue) => `${issue.name} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export const backendEnvVariableNames = [
  "RPC_URL_COSTON2",
  "INDEXER_DB_URL",
  "XRPL_ENDPOINT",
  "FDC_DA_LAYER_URL",
  "KEEPER_PRIVATE_KEY",
  "HARBOR_REDEEMER_ADDRESS",
] as const;

export const optionalBackendEnvVariableNames = [
  "RPC_API_KEY_COSTON2",
  "XRPL_API_KEY",
  "FDC_DA_LAYER_API_KEY",
] as const;

export const frontendEnvVariableNames = [
  "NEXT_PUBLIC_RPC_URL_COSTON2",
  "NEXT_PUBLIC_HARBOR_API_URL",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
  "NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS",
] as const;

export type BackendEnv = Readonly<{
  rpcUrlCoston2: string;
  indexerDbUrl: string;
  xrplEndpoint: string;
  fdcDaLayerUrl: string;
  keeperPrivateKey: HexString;
  harborRedeemerAddress: EvmAddress;
  rpcApiKeyCoston2?: string;
  xrplApiKey?: string;
  fdcDaLayerApiKey?: string;
}>;

export type FrontendEnv = Readonly<{
  publicRpcUrlCoston2: string;
  publicHarborApiUrl: string;
  walletConnectProjectId: string;
  harborContractAddress: EvmAddress;
}>;

const privateKeyPattern = /^0x[a-fA-F0-9]{64}$/;

function requiredString(
  env: EnvInput,
  name: string,
  issues: EnvValidationIssue[],
): string | undefined {
  const value = env[name]?.trim();

  if (!value) {
    issues.push({ name, message: "is required" });
    return undefined;
  }

  return value;
}

function optionalString(env: EnvInput, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
}

function validateUrl(
  env: EnvInput,
  name: string,
  protocols: readonly string[],
  issues: EnvValidationIssue[],
): string | undefined {
  const value = requiredString(env, name, issues);

  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (!protocols.includes(url.protocol)) {
      issues.push({
        name,
        message: `must use one of these protocols: ${protocols.join(", ")}`,
      });
      return undefined;
    }

    return value;
  } catch {
    issues.push({ name, message: "must be a valid URL" });
    return undefined;
  }
}

function isLocalSqlitePath(value: string): boolean {
  if (value === ":memory:") {
    return true;
  }

  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("/") ||
    /\.(db|sqlite|sqlite3)$/i.test(value)
  );
}

function validateDatabaseLocation(
  env: EnvInput,
  name: string,
  issues: EnvValidationIssue[],
): string | undefined {
  const value = requiredString(env, name, issues);

  if (value === undefined) {
    return undefined;
  }

  if (isLocalSqlitePath(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (
      !["file:", "sqlite:", "postgres:", "postgresql:"].includes(url.protocol)
    ) {
      issues.push({
        name,
        message:
          "must be a local SQLite path or use one of these protocols: file:, sqlite:, postgres:, postgresql:",
      });
      return undefined;
    }

    return value;
  } catch {
    issues.push({
      name,
      message:
        "must be a local SQLite path or a valid file:, sqlite:, postgres:, or postgresql: URL",
    });
    return undefined;
  }
}

function validatePrivateKey(
  env: EnvInput,
  name: string,
  issues: EnvValidationIssue[],
): HexString | undefined {
  const value = requiredString(env, name, issues);

  if (value === undefined) {
    return undefined;
  }

  if (!privateKeyPattern.test(value)) {
    issues.push({ name, message: "must be a 32-byte 0x-prefixed hex string" });
    return undefined;
  }

  return value.toLowerCase() as HexString;
}

function validateAddress(
  env: EnvInput,
  name: string,
  issues: EnvValidationIssue[],
): EvmAddress | undefined {
  const value = requiredString(env, name, issues);

  if (value === undefined) {
    return undefined;
  }

  try {
    return normalizeEvmAddress(value);
  } catch {
    issues.push({ name, message: "must be a 20-byte 0x-prefixed hex address" });
    return undefined;
  }
}

function throwIfInvalid(issues: readonly EnvValidationIssue[]): void {
  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }
}

export function validateBackendEnv(env: EnvInput): BackendEnv {
  const issues: EnvValidationIssue[] = [];
  const rpcUrlCoston2 = validateUrl(
    env,
    "RPC_URL_COSTON2",
    ["http:", "https:"],
    issues,
  );
  const indexerDbUrl = validateDatabaseLocation(env, "INDEXER_DB_URL", issues);
  const xrplEndpoint = validateUrl(
    env,
    "XRPL_ENDPOINT",
    ["http:", "https:", "ws:", "wss:"],
    issues,
  );
  const fdcDaLayerUrl = validateUrl(
    env,
    "FDC_DA_LAYER_URL",
    ["http:", "https:"],
    issues,
  );
  const keeperPrivateKey = validatePrivateKey(
    env,
    "KEEPER_PRIVATE_KEY",
    issues,
  );
  const harborRedeemerAddress = validateAddress(
    env,
    "HARBOR_REDEEMER_ADDRESS",
    issues,
  );
  const rpcApiKeyCoston2 = optionalString(env, "RPC_API_KEY_COSTON2");
  const xrplApiKey = optionalString(env, "XRPL_API_KEY");
  const fdcDaLayerApiKey = optionalString(env, "FDC_DA_LAYER_API_KEY");

  throwIfInvalid(issues);

  return {
    rpcUrlCoston2: rpcUrlCoston2!,
    indexerDbUrl: indexerDbUrl!,
    xrplEndpoint: xrplEndpoint!,
    fdcDaLayerUrl: fdcDaLayerUrl!,
    keeperPrivateKey: keeperPrivateKey!,
    harborRedeemerAddress: harborRedeemerAddress!,
    ...(rpcApiKeyCoston2 === undefined ? {} : { rpcApiKeyCoston2 }),
    ...(xrplApiKey === undefined ? {} : { xrplApiKey }),
    ...(fdcDaLayerApiKey === undefined ? {} : { fdcDaLayerApiKey }),
  };
}

export function validateFrontendEnv(env: EnvInput): FrontendEnv {
  const issues: EnvValidationIssue[] = [];
  const publicRpcUrlCoston2 = validateUrl(
    env,
    "NEXT_PUBLIC_RPC_URL_COSTON2",
    ["http:", "https:"],
    issues,
  );
  const publicHarborApiUrl = validateUrl(
    env,
    "NEXT_PUBLIC_HARBOR_API_URL",
    ["http:", "https:"],
    issues,
  );
  const walletConnectProjectId = requiredString(
    env,
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    issues,
  );
  const harborContractAddress = validateAddress(
    env,
    "NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS",
    issues,
  );

  throwIfInvalid(issues);

  return {
    publicRpcUrlCoston2: publicRpcUrlCoston2!,
    publicHarborApiUrl: publicHarborApiUrl!,
    walletConnectProjectId: walletConnectProjectId!,
    harborContractAddress: harborContractAddress!,
  };
}
