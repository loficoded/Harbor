import { xrpPaymentNonexistenceRequestBodyAbi } from "@harbor/protocol";
import {
  normalizeBytes32,
  type Bytes32,
  type EvmAddress,
  type FdcRequestStatus,
  type HexString,
  type IsoTimestamp,
  type XrplAddress,
} from "@harbor/shared";
import { encodeAbiParameters, keccak256 } from "viem";
import { isValidClassicAddress } from "xrpl/dist/npm/utils/index.js";

import type { SqliteDatabase } from "../db/index.js";
import { upsertFdcRequest } from "../repositories/fdc.js";
import { getRedemption } from "../repositories/redemptions.js";
import {
  fdcIdentifier,
  standardXrplAddressHash,
  zeroBytes32,
} from "./referencedPaymentNonexistence.js";
import type {
  RedemptionKey,
  StoredFdcRequestRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";

const uint64Max = (1n << 64n) - 1n;
const destinationTagMax = 0xffffffffn;
const zeroAddress = "0x0000000000000000000000000000000000000000" as EvmAddress;

export const xrpPaymentNonexistenceAttestationTypeName =
  "XRPPaymentNonexistence";
export const defaultXrpPaymentNonexistenceSourceIdName = "testXRP";

export const xrpPaymentNonexistenceAttestationType = fdcIdentifier(
  xrpPaymentNonexistenceAttestationTypeName,
);

export type XrpPaymentNonexistenceRequestBody = Readonly<{
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  destinationAddressHash: Bytes32;
  amount: bigint;
  checkFirstMemoData: boolean;
  firstMemoDataHash: Bytes32;
  checkDestinationTag: boolean;
  destinationTag: bigint;
  proofOwner: EvmAddress;
}>;

export type EncodedXrpPaymentNonexistenceRequest = Readonly<{
  attestationType: Bytes32;
  sourceId: Bytes32;
  sourceIdName: string;
  messageIntegrityCode: Bytes32;
  requestBody: XrpPaymentNonexistenceRequestBody;
  encodedRequestBody: HexString;
  requestBytes: HexString;
  requestHash: Bytes32;
}>;

export type XrpPaymentNonexistenceBuildOptions = Readonly<{
  messageIntegrityCode: Bytes32;
  sourceIdName?: string;
  currentUnixTimestamp?: bigint;
  dryRun?: boolean;
}>;

export type BuildAndPersistXrpPaymentNonexistenceInput = RedemptionKey &
  XrpPaymentNonexistenceBuildOptions &
  Readonly<{
    database: SqliteDatabase;
    status?: FdcRequestStatus;
    createdAt?: IsoTimestamp;
    updatedAt?: IsoTimestamp;
  }>;

export type BuildAndPersistXrpPaymentNonexistenceResult = Readonly<{
  redemption: StoredRedemptionRequest;
  encodedRequest: EncodedXrpPaymentNonexistenceRequest;
  fdcRequest: StoredFdcRequestRecord | null;
  dryRun: boolean;
}>;

/**
 * The FDC "standard hash" of the first Memo's MemoData for an XRP payment. The
 * FAssets agent encodes the redemption payment reference as the first memo's
 * MemoData, so this is `keccak256(bytes(paymentReference))` — the tag-path
 * analog of `standardPaymentReference` in the standard nonexistence proof.
 */
export function standardFirstMemoDataHash(paymentReference: Bytes32): Bytes32 {
  const normalized = normalizeBytes32(paymentReference);
  return keccak256(normalized) as Bytes32;
}

export function createXrpPaymentNonexistenceRequestBody(
  redemption: StoredRedemptionRequest,
): XrpPaymentNonexistenceRequestBody {
  if (redemption.redemptionKind !== "WITH_TAG") {
    throw new Error(
      `Redemption ${redemption.assetManagerAddress}/${redemption.requestId} is not a WITH_TAG redemption`,
    );
  }

  if (redemption.destinationTag === null) {
    throw new Error(
      `Redemption ${redemption.assetManagerAddress}/${redemption.requestId} has no destination tag`,
    );
  }

  if (redemption.destinationTag > destinationTagMax) {
    throw new Error(
      `Redemption ${redemption.assetManagerAddress}/${redemption.requestId} destination tag exceeds uint32`,
    );
  }

  const paymentReference = normalizeBytes32(
    requireString(redemption.paymentReference, "paymentReference"),
  );

  if (paymentReference === zeroBytes32) {
    throw new Error("paymentReference must be non-zero");
  }

  // `xrpRedemptionPaymentDefault` asserts the proof's amount equals the net
  // redemption value (valueUBA - feeUBA), matching the delivered amount the
  // agent must pay. The standard RPNE builder uses gross valueUBA; the XRP
  // default path uses net (verified against the on-chain check).
  const netAmount =
    requireBigint(redemption.valueUBA, "valueUBA") -
    requireBigint(redemption.feeUBA, "feeUBA");

  return {
    minimalBlockNumber: uint64(
      requireBigint(redemption.firstUnderlyingBlock, "firstUnderlyingBlock"),
      "firstUnderlyingBlock",
    ),
    deadlineBlockNumber: uint64(
      requireBigint(redemption.lastUnderlyingBlock, "lastUnderlyingBlock"),
      "lastUnderlyingBlock",
    ),
    deadlineTimestamp: uint64(
      requireBigint(
        redemption.lastUnderlyingTimestamp,
        "lastUnderlyingTimestamp",
      ),
      "lastUnderlyingTimestamp",
    ),
    destinationAddressHash: standardXrplAddressHash(
      requireString(redemption.paymentAddress, "paymentAddress"),
    ),
    amount: uint256(netAmount, "valueUBA - feeUBA"),
    checkFirstMemoData: true,
    firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
    checkDestinationTag: true,
    destinationTag: uint256(redemption.destinationTag, "destinationTag"),
    proofOwner: zeroAddress,
  };
}

export function encodeXrpPaymentNonexistenceRequestBody(
  requestBody: XrpPaymentNonexistenceRequestBody,
): HexString {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: xrpPaymentNonexistenceRequestBodyAbi,
      },
    ],
    [
      [
        requestBody.minimalBlockNumber,
        requestBody.deadlineBlockNumber,
        requestBody.deadlineTimestamp,
        requestBody.destinationAddressHash,
        requestBody.amount,
        requestBody.checkFirstMemoData,
        requestBody.firstMemoDataHash,
        requestBody.checkDestinationTag,
        requestBody.destinationTag,
        requestBody.proofOwner,
      ],
    ],
  );
}

export function encodeXrpPaymentNonexistenceRequest(
  input: Readonly<{
    requestBody: XrpPaymentNonexistenceRequestBody;
    messageIntegrityCode: Bytes32;
    sourceIdName?: string;
  }>,
): EncodedXrpPaymentNonexistenceRequest {
  const sourceIdName =
    input.sourceIdName ?? defaultXrpPaymentNonexistenceSourceIdName;
  const attestationType = xrpPaymentNonexistenceAttestationType;
  const sourceId = fdcIdentifier(sourceIdName);
  const messageIntegrityCode = normalizeBytes32(input.messageIntegrityCode);
  const encodedRequestBody = encodeXrpPaymentNonexistenceRequestBody(
    input.requestBody,
  );
  const requestBytes = concatHex([
    attestationType,
    sourceId,
    messageIntegrityCode,
    encodedRequestBody,
  ]);

  return {
    attestationType,
    sourceId,
    sourceIdName,
    messageIntegrityCode,
    requestBody: input.requestBody,
    encodedRequestBody,
    requestBytes,
    requestHash: keccak256(requestBytes) as Bytes32,
  };
}

export function buildXrpPaymentNonexistenceRequest(
  redemption: StoredRedemptionRequest,
  options: XrpPaymentNonexistenceBuildOptions,
): EncodedXrpPaymentNonexistenceRequest {
  assertDeadlinePassed(redemption, options);

  const encodeInput: Parameters<typeof encodeXrpPaymentNonexistenceRequest>[0] =
    {
      requestBody: createXrpPaymentNonexistenceRequestBody(redemption),
      messageIntegrityCode: options.messageIntegrityCode,
    };

  if (options.sourceIdName !== undefined) {
    return encodeXrpPaymentNonexistenceRequest({
      ...encodeInput,
      sourceIdName: options.sourceIdName,
    });
  }

  return encodeXrpPaymentNonexistenceRequest(encodeInput);
}

export function buildAndPersistXrpPaymentNonexistenceRequest(
  input: BuildAndPersistXrpPaymentNonexistenceInput,
): BuildAndPersistXrpPaymentNonexistenceResult {
  const redemption = getRedemption(input.database, input);

  if (redemption === null) {
    throw new Error(
      `Redemption ${input.assetManagerAddress}/${input.requestId} does not exist`,
    );
  }

  const buildOptions = {
    messageIntegrityCode: input.messageIntegrityCode,
    ...(input.sourceIdName === undefined
      ? {}
      : { sourceIdName: input.sourceIdName }),
    ...(input.currentUnixTimestamp === undefined
      ? {}
      : {
          currentUnixTimestamp: input.currentUnixTimestamp,
        }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
  } satisfies XrpPaymentNonexistenceBuildOptions;

  const encodedRequest = buildXrpPaymentNonexistenceRequest(
    redemption,
    buildOptions,
  );

  if (input.dryRun === true) {
    return {
      redemption,
      encodedRequest,
      fdcRequest: null,
      dryRun: true,
    };
  }

  const upsertInput = {
    fdcRequestId: fdcRequestId(encodedRequest.requestHash),
    redemptionRequestId: redemption.requestId,
    assetManagerAddress: redemption.assetManagerAddress,
    attestationType: encodedRequest.attestationType,
    sourceId: encodedRequest.sourceId,
    sourceChainId: redemption.sourceChainId,
    requestBody: encodedRequest.requestBytes,
    requestHash: encodedRequest.requestHash,
    status: input.status ?? "PENDING",
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  } satisfies Parameters<typeof upsertFdcRequest>[1];

  const fdcRequest = upsertFdcRequest(input.database, upsertInput);

  return {
    redemption,
    encodedRequest,
    fdcRequest,
    dryRun: false,
  };
}

function assertDeadlinePassed(
  redemption: StoredRedemptionRequest,
  options: Pick<
    XrpPaymentNonexistenceBuildOptions,
    "currentUnixTimestamp" | "dryRun"
  >,
): void {
  if (options.dryRun === true) {
    return;
  }

  const currentUnixTimestamp =
    options.currentUnixTimestamp ?? BigInt(Math.floor(Date.now() / 1000));

  if (currentUnixTimestamp <= redemption.lastUnderlyingTimestamp) {
    throw new Error(
      `Redemption ${redemption.assetManagerAddress}/${redemption.requestId} payment deadline has not passed`,
    );
  }
}

function concatHex(values: readonly HexString[]): HexString {
  return `0x${values.map((value) => value.slice(2)).join("")}` as HexString;
}

function fdcRequestId(requestHash: Bytes32): string {
  return `xrp-payment-nonexistence:${requestHash}`;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function requireBigint(value: unknown, fieldName: string): bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function uint64(value: bigint, fieldName: string): bigint {
  const unsignedValue = uint256(value, fieldName);

  if (unsignedValue > uint64Max) {
    throw new Error(`${fieldName} exceeds uint64`);
  }

  return unsignedValue;
}

function uint256(value: bigint, fieldName: string): bigint {
  if (value < 0n) {
    throw new Error(`${fieldName} cannot be negative`);
  }

  return value;
}

// Re-exported so the XRPL address hash helper is reachable from this module's
// public surface without consumers importing the standard-path module.
export { isValidClassicAddress };
