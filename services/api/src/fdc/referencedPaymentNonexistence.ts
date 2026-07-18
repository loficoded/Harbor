import { referencedPaymentNonexistenceRequestBodyAbi } from "@harbor/protocol";
import {
  normalizeBytes32,
  type Bytes32,
  type FdcRequestStatus,
  type HexString,
  type IsoTimestamp,
  type XrplAddress,
} from "@harbor/shared";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { isValidClassicAddress } from "xrpl/dist/npm/utils/index.js";

import type { SqliteDatabase } from "../db/index.js";
import { upsertFdcRequest } from "../repositories/fdc.js";
import { getRedemption } from "../repositories/redemptions.js";
import type {
  RedemptionKey,
  StoredFdcRequestRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";
import {
  assertDeadlinePassed,
  concatHex,
  fdcRequestId,
  requireBigint,
  requireString,
  uint256,
  uint64,
} from "./encoding.js";

const fdcIdentifierPattern = /^[A-Za-z0-9]+$/;

export const referencedPaymentNonexistenceAttestationTypeName =
  "ReferencedPaymentNonexistence";
export const defaultReferencedPaymentNonexistenceSourceIdName = "testXRP";
export const zeroBytes32 = `0x${"00".repeat(32)}` as Bytes32;

export const referencedPaymentNonexistenceAttestationType = fdcIdentifier(
  referencedPaymentNonexistenceAttestationTypeName,
);

export type ReferencedPaymentNonexistenceRequestBody = Readonly<{
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  destinationAddressHash: Bytes32;
  amount: bigint;
  standardPaymentReference: Bytes32;
  checkSourceAddresses: boolean;
  sourceAddressesRoot: Bytes32;
}>;

export type EncodedReferencedPaymentNonexistenceRequest = Readonly<{
  attestationType: Bytes32;
  sourceId: Bytes32;
  sourceIdName: string;
  messageIntegrityCode: Bytes32;
  requestBody: ReferencedPaymentNonexistenceRequestBody;
  encodedRequestBody: HexString;
  requestBytes: HexString;
  requestHash: Bytes32;
}>;

export type ReferencedPaymentNonexistenceBuildOptions = Readonly<{
  messageIntegrityCode: Bytes32;
  sourceIdName?: string;
  currentUnixTimestamp?: bigint;
  dryRun?: boolean;
}>;

export type BuildAndPersistReferencedPaymentNonexistenceInput = RedemptionKey &
  ReferencedPaymentNonexistenceBuildOptions &
  Readonly<{
    database: SqliteDatabase;
    status?: FdcRequestStatus;
    createdAt?: IsoTimestamp;
    updatedAt?: IsoTimestamp;
  }>;

export type BuildAndPersistReferencedPaymentNonexistenceResult = Readonly<{
  redemption: StoredRedemptionRequest;
  encodedRequest: EncodedReferencedPaymentNonexistenceRequest;
  fdcRequest: StoredFdcRequestRecord | null;
  dryRun: boolean;
}>;

export function fdcIdentifier(name: string): Bytes32 {
  if (!fdcIdentifierPattern.test(name) || name.length > 32) {
    throw new Error(`Invalid FDC identifier: ${name}`);
  }

  return stringToHex(name, { size: 32 }) as Bytes32;
}

/**
 * Flare FDC standard address hash for XRPL addresses, per flare-specs
 * `src/FDC/AttestationTypes/Reference.md`: keccak256(bytes(standardAddress)).
 * XRPL classic addresses have a single standard string form; X-addresses are
 * deliberately rejected because FAssets redemptions persist plain destinations.
 */
export function standardXrplAddressHash(address: XrplAddress): Bytes32 {
  if (address.trim() === "" || !isValidClassicAddress(address)) {
    throw new Error(`Invalid XRPL classic address: ${address}`);
  }

  return keccak256(new TextEncoder().encode(address)) as Bytes32;
}

export function createReferencedPaymentNonexistenceRequestBody(
  redemption: StoredRedemptionRequest,
): ReferencedPaymentNonexistenceRequestBody {
  const paymentReference = normalizeBytes32(
    requireString(redemption.paymentReference, "paymentReference"),
  );

  if (paymentReference === zeroBytes32) {
    throw new Error("paymentReference must be non-zero");
  }

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
    amount: uint256(requireBigint(redemption.valueUBA, "valueUBA"), "valueUBA"),
    standardPaymentReference: paymentReference,
    checkSourceAddresses: false,
    sourceAddressesRoot: zeroBytes32,
  };
}

export function encodeReferencedPaymentNonexistenceRequestBody(
  requestBody: ReferencedPaymentNonexistenceRequestBody,
): HexString {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: referencedPaymentNonexistenceRequestBodyAbi,
      },
    ],
    [
      [
        requestBody.minimalBlockNumber,
        requestBody.deadlineBlockNumber,
        requestBody.deadlineTimestamp,
        requestBody.destinationAddressHash,
        requestBody.amount,
        requestBody.standardPaymentReference,
        requestBody.checkSourceAddresses,
        requestBody.sourceAddressesRoot,
      ],
    ],
  );
}

export function encodeReferencedPaymentNonexistenceRequest(
  input: Readonly<{
    requestBody: ReferencedPaymentNonexistenceRequestBody;
    messageIntegrityCode: Bytes32;
    sourceIdName?: string;
  }>,
): EncodedReferencedPaymentNonexistenceRequest {
  const sourceIdName =
    input.sourceIdName ?? defaultReferencedPaymentNonexistenceSourceIdName;
  const attestationType = referencedPaymentNonexistenceAttestationType;
  const sourceId = fdcIdentifier(sourceIdName);
  const messageIntegrityCode = normalizeBytes32(input.messageIntegrityCode);
  const encodedRequestBody = encodeReferencedPaymentNonexistenceRequestBody(
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

export function buildReferencedPaymentNonexistenceRequest(
  redemption: StoredRedemptionRequest,
  options: ReferencedPaymentNonexistenceBuildOptions,
): EncodedReferencedPaymentNonexistenceRequest {
  assertDeadlinePassed(redemption, options);

  const encodeInput: Parameters<
    typeof encodeReferencedPaymentNonexistenceRequest
  >[0] = {
    requestBody: createReferencedPaymentNonexistenceRequestBody(redemption),
    messageIntegrityCode: options.messageIntegrityCode,
  };

  if (options.sourceIdName !== undefined) {
    return encodeReferencedPaymentNonexistenceRequest({
      ...encodeInput,
      sourceIdName: options.sourceIdName,
    });
  }

  return encodeReferencedPaymentNonexistenceRequest(encodeInput);
}

export function buildAndPersistReferencedPaymentNonexistenceRequest(
  input: BuildAndPersistReferencedPaymentNonexistenceInput,
): BuildAndPersistReferencedPaymentNonexistenceResult {
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
  } satisfies ReferencedPaymentNonexistenceBuildOptions;

  const encodedRequest = buildReferencedPaymentNonexistenceRequest(
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
    fdcRequestId: fdcRequestId(
      "referenced-payment-nonexistence",
      encodedRequest.requestHash,
    ),
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

// Encoding primitives (assertDeadlinePassed, concatHex, fdcRequestId,
// requireString, requireBigint, uint64, uint256, uint64Max) now live in
// ./encoding.ts, shared byte-for-byte with the XRP nonexistence lane.
