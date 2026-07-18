import {
  coston2Chain,
  referencedPaymentNonexistenceResponseAbi,
  xrpPaymentNonexistenceResponseAbi,
} from "@harbor/protocol";
import {
  normalizeBytes32,
  normalizeEvmAddress,
  serializeBigints,
  type Bytes32,
  type EvmAddress,
  type HexString,
} from "@harbor/shared";
import { setTimeout as defaultSleep } from "node:timers/promises";
import { decodeAbiParameters, encodeAbiParameters } from "viem";

import type { ReferencedPaymentNonexistenceRequestBody } from "./referencedPaymentNonexistence.js";
import type { XrpPaymentNonexistenceRequestBody } from "./xrpPaymentNonexistence.js";

export const defaultDaLayerProofPath = "/api/v1/fdc/proof-by-request-round";
export const defaultCoston2DaLayerBaseUrl =
  coston2Chain.fdc.dataAvailabilityApi.replace(/\/api-doc\/?$/, "");

const referencedPaymentNonexistenceResponseTupleAbi = [
  {
    type: "tuple",
    components: referencedPaymentNonexistenceResponseAbi,
  },
] as const;

const xrpPaymentNonexistenceResponseTupleAbi = [
  {
    type: "tuple",
    components: xrpPaymentNonexistenceResponseAbi,
  },
] as const;

export type DaLayerHttpResponse = Readonly<{
  status: number;
  ok: boolean;
  headers?:
    { get(name: string): string | null } | Record<string, string | undefined>;
  text(): Promise<string>;
}>;

export type DaLayerFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<DaLayerHttpResponse>;

export type DaLayerRetryOptions = Readonly<{
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export type ReferencedPaymentNonexistenceResponseBody = Readonly<{
  minimalBlockTimestamp: bigint;
  firstOverflowBlockNumber: bigint;
  firstOverflowBlockTimestamp: bigint;
}>;

export type ReferencedPaymentNonexistenceResponseData = Readonly<{
  attestationType: Bytes32;
  sourceId: Bytes32;
  votingRound: bigint;
  lowestUsedTimestamp: bigint;
  requestBody: ReferencedPaymentNonexistenceRequestBody;
  responseBody: ReferencedPaymentNonexistenceResponseBody;
}>;

export type ReferencedPaymentNonexistenceProofCalldata = Readonly<{
  merkleProof: readonly Bytes32[];
  data: ReferencedPaymentNonexistenceResponseData;
}>;

export type NormalizedReferencedPaymentNonexistenceProof = Readonly<{
  proofCalldata: ReferencedPaymentNonexistenceProofCalldata;
  encodedResponse: HexString;
  proofJson: string;
  calldataJson: string;
}>;

// ---------------------------------------------------------------------------
// XRPPaymentNonexistence — the redeem-by-tag default proof.
// ---------------------------------------------------------------------------

export type XrpPaymentNonexistenceResponseBody = Readonly<{
  minimalBlockTimestamp: bigint;
  firstOverflowBlockNumber: bigint;
  firstOverflowBlockTimestamp: bigint;
}>;

export type XrpPaymentNonexistenceResponseData = Readonly<{
  attestationType: Bytes32;
  sourceId: Bytes32;
  votingRound: bigint;
  lowestUsedTimestamp: bigint;
  requestBody: XrpPaymentNonexistenceRequestBody;
  responseBody: XrpPaymentNonexistenceResponseBody;
}>;

export type XrpPaymentNonexistenceProofCalldata = Readonly<{
  merkleProof: readonly Bytes32[];
  data: XrpPaymentNonexistenceResponseData;
}>;

export type NormalizedXrpPaymentNonexistenceProof = Readonly<{
  proofCalldata: XrpPaymentNonexistenceProofCalldata;
  encodedResponse: HexString;
  proofJson: string;
  calldataJson: string;
}>;

export type DaLayerProofReadyResult =
  | (NormalizedReferencedPaymentNonexistenceProof &
      Readonly<{
        status: "PROOF_READY";
      }>)
  | (NormalizedXrpPaymentNonexistenceProof &
      Readonly<{
        status: "PROOF_READY";
      }>);

export type DaLayerProofNotReadyResult = Readonly<{
  status: "NOT_READY";
  lastError: string;
  retryAfterMs: number | null;
}>;

export type DaLayerProofResult =
  DaLayerProofReadyResult | DaLayerProofNotReadyResult;

type DaLayerProofRequestInput = {
  votingRoundId: bigint;
  requestBytes: HexString;
  baseUrl?: string | undefined;
  proofPath?: string | undefined;
  apiKey?: string | undefined;
  fetch?: DaLayerFetch | undefined;
  retry?: DaLayerRetryOptions | undefined;
};

type AnyDaLayerNormalizedProof =
  | NormalizedReferencedPaymentNonexistenceProof
  | NormalizedXrpPaymentNonexistenceProof;

type DaLayerProofNormalizer = (payload: unknown) => AnyDaLayerNormalizedProof;

export async function requestReferencedPaymentNonexistenceProof(input: {
  votingRoundId: bigint;
  requestBytes: HexString;
  baseUrl?: string | undefined;
  proofPath?: string | undefined;
  apiKey?: string | undefined;
  fetch?: DaLayerFetch | undefined;
  retry?: DaLayerRetryOptions | undefined;
}): Promise<DaLayerProofResult> {
  return requestDaLayerProof(input, (payload) =>
    normalizeReferencedPaymentNonexistenceProof(payload),
  );
}

export async function requestXrpPaymentNonexistenceProof(input: {
  votingRoundId: bigint;
  requestBytes: HexString;
  baseUrl?: string | undefined;
  proofPath?: string | undefined;
  apiKey?: string | undefined;
  fetch?: DaLayerFetch | undefined;
  retry?: DaLayerRetryOptions | undefined;
}): Promise<DaLayerProofResult> {
  return requestDaLayerProof(input, (payload) =>
    normalizeXrpPaymentNonexistenceProof(payload),
  );
}

async function requestDaLayerProof(
  input: DaLayerProofRequestInput,
  normalize: DaLayerProofNormalizer,
): Promise<DaLayerProofResult> {
  const retryOptions = resolveDaLayerRetryOptions(input.retry);
  let delayMs = retryOptions.initialDelayMs;
  let lastNotReady: DaLayerProofNotReadyResult | null = null;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt += 1) {
    const result = await requestDaLayerProofOnce(input, normalize);

    if (result.status === "PROOF_READY") {
      return result;
    }

    lastNotReady = result;

    if (attempt === retryOptions.maxRetries) {
      return result;
    }

    const nextDelayMs = result.retryAfterMs ?? delayMs;
    await retryOptions.sleep(nextDelayMs);
    delayMs = Math.min(delayMs * 2, retryOptions.maxDelayMs);
  }

  return lastNotReady!;
}

async function requestDaLayerProofOnce(
  input: DaLayerProofRequestInput,
  normalize: DaLayerProofNormalizer,
): Promise<DaLayerProofResult> {
  const fetch = input.fetch ?? defaultDaLayerFetch();
  const response = await fetch(
    resolveDaLayerProofUrl(input.baseUrl, input.proofPath),
    {
      method: "POST",
      headers: daLayerHeaders(input.apiKey),
      body: JSON.stringify({
        votingRoundId: safeNumber(input.votingRoundId, "votingRoundId"),
        requestBytes: input.requestBytes,
      }),
    },
  );

  if (response.status === 204 || response.status === 404) {
    return notReady(
      `DA Layer proof is not ready: HTTP ${response.status}`,
      response,
    );
  }

  if (response.status === 429 || response.status >= 500) {
    return notReady(`DA Layer temporary HTTP ${response.status}`, response);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`DA Layer HTTP ${response.status}: ${text}`);
  }

  const payload = parseJsonPreservingIntegerStrings(text);

  if (isDaLayerEmptyPayload(payload)) {
    return {
      status: "NOT_READY",
      lastError: "DA Layer proof is not ready",
      retryAfterMs: parseRetryAfterMs(response),
    };
  }

  return {
    status: "PROOF_READY",
    ...normalize(payload),
  };
}

export function resolveDaLayerProofUrl(
  baseUrl = defaultCoston2DaLayerBaseUrl,
  proofPath = defaultDaLayerProofPath,
): string {
  const normalizedBaseUrl = baseUrl
    .replace(/\/api-doc\/?$/, "")
    .replace(/\/$/, "");
  const normalizedProofPath = proofPath.startsWith("/")
    ? proofPath.slice(1)
    : proofPath;

  return new URL(normalizedProofPath, `${normalizedBaseUrl}/`).toString();
}

export function normalizeReferencedPaymentNonexistenceProof(
  payload: unknown,
): NormalizedReferencedPaymentNonexistenceProof {
  const payloadRecord = requireRecord(payload, "DA Layer proof payload");
  const proof = requireArray(payloadRecord.proof, "proof").map((entry) =>
    normalizeBytes32(requireString(entry, "proof entry")),
  );
  const encodedResponseFromPayload = optionalHex(
    payloadRecord.response_hex ??
      payloadRecord.responseHex ??
      payloadRecord.response_body ??
      payloadRecord.responseBody,
  );
  const response =
    payloadRecord.response ??
    (encodedResponseFromPayload === null
      ? undefined
      : decodeReferencedPaymentNonexistenceResponse(
          encodedResponseFromPayload,
        ));

  if (response === undefined) {
    throw new Error("DA Layer proof payload is missing response");
  }

  const data = normalizeReferencedPaymentNonexistenceResponse(response);
  const encodedResponse =
    encodedResponseFromPayload ??
    encodeReferencedPaymentNonexistenceResponse(data);
  const proofCalldata = {
    merkleProof: proof,
    data,
  } as const satisfies ReferencedPaymentNonexistenceProofCalldata;

  return {
    proofCalldata,
    encodedResponse,
    proofJson: JSON.stringify(serializeBigints(payload)),
    calldataJson: JSON.stringify(serializeBigints(proofCalldata)),
  };
}

export function encodeReferencedPaymentNonexistenceResponse(
  response: ReferencedPaymentNonexistenceResponseData,
): HexString {
  return encodeAbiParameters(referencedPaymentNonexistenceResponseTupleAbi, [
    [
      response.attestationType,
      response.sourceId,
      response.votingRound,
      response.lowestUsedTimestamp,
      [
        response.requestBody.minimalBlockNumber,
        response.requestBody.deadlineBlockNumber,
        response.requestBody.deadlineTimestamp,
        response.requestBody.destinationAddressHash,
        response.requestBody.amount,
        response.requestBody.standardPaymentReference,
        response.requestBody.checkSourceAddresses,
        response.requestBody.sourceAddressesRoot,
      ],
      response.responseBody,
    ],
  ]) as HexString;
}

export function decodeReferencedPaymentNonexistenceResponse(
  encodedResponse: HexString,
): unknown {
  return decodeAbiParameters(
    referencedPaymentNonexistenceResponseTupleAbi,
    encodedResponse,
  )[0];
}

export function normalizeReferencedPaymentNonexistenceResponse(
  response: unknown,
): ReferencedPaymentNonexistenceResponseData {
  const requestBody = tupleField(response, "requestBody", 4);
  const responseBody = tupleField(response, "responseBody", 5);

  return {
    attestationType: normalizeBytes32(
      requireString(
        tupleField(response, "attestationType", 0),
        "attestationType",
      ),
    ),
    sourceId: normalizeBytes32(
      requireString(tupleField(response, "sourceId", 1), "sourceId"),
    ),
    votingRound: parseInteger(
      tupleField(response, "votingRound", 2),
      "votingRound",
    ),
    lowestUsedTimestamp: parseInteger(
      tupleField(response, "lowestUsedTimestamp", 3),
      "lowestUsedTimestamp",
    ),
    requestBody: {
      minimalBlockNumber: parseInteger(
        tupleField(requestBody, "minimalBlockNumber", 0),
        "minimalBlockNumber",
      ),
      deadlineBlockNumber: parseInteger(
        tupleField(requestBody, "deadlineBlockNumber", 1),
        "deadlineBlockNumber",
      ),
      deadlineTimestamp: parseInteger(
        tupleField(requestBody, "deadlineTimestamp", 2),
        "deadlineTimestamp",
      ),
      destinationAddressHash: normalizeBytes32(
        requireString(
          tupleField(requestBody, "destinationAddressHash", 3),
          "destinationAddressHash",
        ),
      ),
      amount: parseInteger(tupleField(requestBody, "amount", 4), "amount"),
      standardPaymentReference: normalizeBytes32(
        requireString(
          tupleField(requestBody, "standardPaymentReference", 5),
          "standardPaymentReference",
        ),
      ),
      checkSourceAddresses: requireBoolean(
        tupleField(requestBody, "checkSourceAddresses", 6),
        "checkSourceAddresses",
      ),
      sourceAddressesRoot: normalizeBytes32(
        requireString(
          tupleField(requestBody, "sourceAddressesRoot", 7),
          "sourceAddressesRoot",
        ),
      ),
    },
    responseBody: {
      minimalBlockTimestamp: parseInteger(
        tupleField(responseBody, "minimalBlockTimestamp", 0),
        "minimalBlockTimestamp",
      ),
      firstOverflowBlockNumber: parseInteger(
        tupleField(responseBody, "firstOverflowBlockNumber", 1),
        "firstOverflowBlockNumber",
      ),
      firstOverflowBlockTimestamp: parseInteger(
        tupleField(responseBody, "firstOverflowBlockTimestamp", 2),
        "firstOverflowBlockTimestamp",
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// XRPPaymentNonexistence normalize / encode / decode
// ---------------------------------------------------------------------------

export function normalizeXrpPaymentNonexistenceProof(
  payload: unknown,
): NormalizedXrpPaymentNonexistenceProof {
  const payloadRecord = requireRecord(payload, "DA Layer proof payload");
  const proof = requireArray(payloadRecord.proof, "proof").map((entry) =>
    normalizeBytes32(requireString(entry, "proof entry")),
  );
  const encodedResponseFromPayload = optionalHex(
    payloadRecord.response_hex ??
      payloadRecord.responseHex ??
      payloadRecord.response_body ??
      payloadRecord.responseBody,
  );
  const response =
    payloadRecord.response ??
    (encodedResponseFromPayload === null
      ? undefined
      : decodeXrpPaymentNonexistenceResponse(encodedResponseFromPayload));

  if (response === undefined) {
    throw new Error("DA Layer proof payload is missing response");
  }

  const data = normalizeXrpPaymentNonexistenceResponse(response);
  const encodedResponse =
    encodedResponseFromPayload ?? encodeXrpPaymentNonexistenceResponse(data);
  const proofCalldata = {
    merkleProof: proof,
    data,
  } as const satisfies XrpPaymentNonexistenceProofCalldata;

  return {
    proofCalldata,
    encodedResponse,
    proofJson: JSON.stringify(serializeBigints(payload)),
    calldataJson: JSON.stringify(serializeBigints(proofCalldata)),
  };
}

export function encodeXrpPaymentNonexistenceResponse(
  response: XrpPaymentNonexistenceResponseData,
): HexString {
  return encodeAbiParameters(xrpPaymentNonexistenceResponseTupleAbi, [
    [
      response.attestationType,
      response.sourceId,
      response.votingRound,
      response.lowestUsedTimestamp,
      [
        response.requestBody.minimalBlockNumber,
        response.requestBody.deadlineBlockNumber,
        response.requestBody.deadlineTimestamp,
        response.requestBody.destinationAddressHash,
        response.requestBody.amount,
        response.requestBody.checkFirstMemoData,
        response.requestBody.firstMemoDataHash,
        response.requestBody.checkDestinationTag,
        response.requestBody.destinationTag,
        response.requestBody.proofOwner,
      ],
      response.responseBody,
    ],
  ]) as HexString;
}

export function decodeXrpPaymentNonexistenceResponse(
  encodedResponse: HexString,
): unknown {
  return decodeAbiParameters(
    xrpPaymentNonexistenceResponseTupleAbi,
    encodedResponse,
  )[0];
}

export function normalizeXrpPaymentNonexistenceResponse(
  response: unknown,
): XrpPaymentNonexistenceResponseData {
  const requestBody = tupleField(response, "requestBody", 4);
  const responseBody = tupleField(response, "responseBody", 5);

  return {
    attestationType: normalizeBytes32(
      requireString(
        tupleField(response, "attestationType", 0),
        "attestationType",
      ),
    ),
    sourceId: normalizeBytes32(
      requireString(tupleField(response, "sourceId", 1), "sourceId"),
    ),
    votingRound: parseInteger(
      tupleField(response, "votingRound", 2),
      "votingRound",
    ),
    lowestUsedTimestamp: parseInteger(
      tupleField(response, "lowestUsedTimestamp", 3),
      "lowestUsedTimestamp",
    ),
    requestBody: {
      minimalBlockNumber: parseInteger(
        tupleField(requestBody, "minimalBlockNumber", 0),
        "minimalBlockNumber",
      ),
      deadlineBlockNumber: parseInteger(
        tupleField(requestBody, "deadlineBlockNumber", 1),
        "deadlineBlockNumber",
      ),
      deadlineTimestamp: parseInteger(
        tupleField(requestBody, "deadlineTimestamp", 2),
        "deadlineTimestamp",
      ),
      destinationAddressHash: normalizeBytes32(
        requireString(
          tupleField(requestBody, "destinationAddressHash", 3),
          "destinationAddressHash",
        ),
      ),
      amount: parseInteger(tupleField(requestBody, "amount", 4), "amount"),
      checkFirstMemoData: requireBoolean(
        tupleField(requestBody, "checkFirstMemoData", 5),
        "checkFirstMemoData",
      ),
      firstMemoDataHash: normalizeBytes32(
        requireString(
          tupleField(requestBody, "firstMemoDataHash", 6),
          "firstMemoDataHash",
        ),
      ),
      checkDestinationTag: requireBoolean(
        tupleField(requestBody, "checkDestinationTag", 7),
        "checkDestinationTag",
      ),
      destinationTag: parseInteger(
        tupleField(requestBody, "destinationTag", 8),
        "destinationTag",
      ),
      proofOwner: normalizeEvmAddress(
        requireString(tupleField(requestBody, "proofOwner", 9), "proofOwner"),
      ),
    },
    responseBody: {
      minimalBlockTimestamp: parseInteger(
        tupleField(responseBody, "minimalBlockTimestamp", 0),
        "minimalBlockTimestamp",
      ),
      firstOverflowBlockNumber: parseInteger(
        tupleField(responseBody, "firstOverflowBlockNumber", 1),
        "firstOverflowBlockNumber",
      ),
      firstOverflowBlockTimestamp: parseInteger(
        tupleField(responseBody, "firstOverflowBlockTimestamp", 2),
        "firstOverflowBlockTimestamp",
      ),
    },
  };
}

export function parseJsonPreservingIntegerStrings(text: string): unknown {
  return JSON.parse(quoteJsonIntegerTokens(text));
}

function quoteJsonIntegerTokens(input: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let isEscaped = false;

  while (index < input.length) {
    const char = input[index]!;

    if (inString) {
      output += char;

      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }

      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === "-" || isDigit(char)) {
      const start = index;
      let cursor = char === "-" ? index + 1 : index;

      if (cursor >= input.length || !isDigit(input[cursor]!)) {
        output += char;
        index += 1;
        continue;
      }

      while (cursor < input.length && isDigit(input[cursor]!)) {
        cursor += 1;
      }

      if (
        input[cursor] === "." ||
        input[cursor] === "e" ||
        input[cursor] === "E"
      ) {
        while (cursor < input.length && /[0-9eE+\-.]/.test(input[cursor]!)) {
          cursor += 1;
        }

        output += input.slice(start, cursor);
      } else {
        output += `"${input.slice(start, cursor)}"`;
      }

      index = cursor;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function isDaLayerEmptyPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) {
    return true;
  }

  if (typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const status =
    typeof record.status === "string" ? record.status.toUpperCase() : "";

  return (
    (record.response === undefined && record.proof === undefined) ||
    status === "EMPTY" ||
    status === "PENDING" ||
    status === "NOT_READY"
  );
}

function notReady(
  message: string,
  response: DaLayerHttpResponse,
): DaLayerProofNotReadyResult {
  return {
    status: "NOT_READY",
    lastError: message,
    retryAfterMs: parseRetryAfterMs(response),
  };
}

function parseRetryAfterMs(response: DaLayerHttpResponse): number | null {
  const retryAfter = headerValue(response.headers, "retry-after");

  if (retryAfter === null) {
    return null;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function headerValue(
  headers: DaLayerHttpResponse["headers"],
  name: string,
): string | null {
  if (headers === undefined) {
    return null;
  }

  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }

  const headerRecord = headers as Record<string, string | undefined>;
  return headerRecord[name] ?? headerRecord[name.toLowerCase()] ?? null;
}

function resolveDaLayerRetryOptions(
  options: DaLayerRetryOptions = {},
): Required<DaLayerRetryOptions> {
  return {
    maxRetries: options.maxRetries ?? 3,
    initialDelayMs: options.initialDelayMs ?? 1_000,
    maxDelayMs: options.maxDelayMs ?? 10_000,
    sleep: options.sleep ?? defaultSleep,
  };
}

function daLayerHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (apiKey !== undefined && apiKey.trim() !== "") {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function defaultDaLayerFetch(): DaLayerFetch {
  const fetch = globalThis.fetch as unknown;

  if (typeof fetch !== "function") {
    throw new Error("No fetch implementation is available");
  }

  return fetch as DaLayerFetch;
}

function optionalHex(value: unknown): HexString | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = requireString(value, "hex value")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!/^0x[0-9a-f]*$/.test(text) || text.length % 2 !== 0) {
    throw new Error(`Invalid hex value: ${String(value)}`);
  }

  return text as HexString;
}

function tupleField(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) {
    return value[index];
  }

  const record = requireRecord(value, name);

  if (!(name in record)) {
    throw new Error(`${name} is required`);
  }

  return record[name];
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }

  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be boolean`);
  }

  return value;
}

function parseInteger(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${name} must be an integer`);
}

function safeNumber(value: bigint, name: string): number {
  const numberValue = Number(value);

  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${name} must fit in a non-negative safe integer`);
  }

  return numberValue;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}
