import { xrpPaymentNonexistenceRequestBodyAbi } from "@harbor/protocol";
import {
  netUnderlyingUBA,
  normalizeBytes32,
  normalizeDestinationTag,
  type Bytes32,
  type EvmAddress,
  type FdcRequestStatus,
  type HexString,
  type IsoTimestamp,
} from "@harbor/shared";
import { encodeAbiParameters, keccak256 } from "viem";

import type { SqliteDatabase } from "../db/index.js";
import { upsertFdcRequest } from "../repositories/fdc.js";
import { getRedemption } from "../repositories/redemptions.js";
import {
  fdcIdentifier,
  standardXrplAddressHash,
  zeroBytes32,
} from "./referencedPaymentNonexistence.js";
import {
  assertDeadlinePassed,
  concatHex,
  fdcRequestId,
  requireBigint,
  requireString,
  uint256,
  uint64,
} from "./encoding.js";
import type {
  RedemptionKey,
  StoredFdcRequestRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";

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

  // Validate the uint32 bound via the shared normalizer (one source of truth
  // for tag parsing/bounds across the app), not an inline comparison.
  const destinationTag = normalizeDestinationTag(redemption.destinationTag);
  if (destinationTag === null) {
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
  // redemption value (`valueUBA - feeUBA`) — the amount the agent had to deliver
  // to the redeemer (the agent keeps the fee). This is the same net amount the
  // standard `redemptionPaymentDefault` requires, the XRPL observer matches a
  // delivered payment against, and the keeper settlement check uses: all four
  // sites go through the shared `netUnderlyingUBA` helper so they cannot drift.
  const netAmount = netUnderlyingUBA(
    requireBigint(redemption.valueUBA, "valueUBA"),
    requireBigint(redemption.feeUBA, "feeUBA"),
  );

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
    destinationTag: uint256(destinationTag, "destinationTag"),
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
    fdcRequestId: fdcRequestId(
      "xrp-payment-nonexistence",
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
// ./encoding.ts, shared byte-for-byte with the standard nonexistence lane.
