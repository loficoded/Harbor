import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  Bytes32,
  EvmAddress,
  IsoTimestamp,
  TransactionHash,
} from "@harbor/shared";

import type {
  StoredFdcProofRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";
import { normalizeXrpPaymentNonexistenceProof } from "../fdc/daLayer.js";
import { fdcIdentifier } from "../fdc/referencedPaymentNonexistence.js";
import {
  standardFirstMemoDataHash,
  xrpPaymentNonexistenceAttestationType,
} from "../fdc/xrpPaymentNonexistence.js";
import {
  buildExecuteDefaultParameters,
  parseStoredXrpFdcProofCalldata,
} from "./defaultExecutor.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const harborRedeemerAddress = `0x${"12".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const keeperAccount = `0x${"99".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const proofNode = `0x${"03".repeat(32)}` as Bytes32;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const destinationAddressHash = `0x${"04".repeat(32)}` as Bytes32;
const firstMemoDataHash = standardFirstMemoDataHash(paymentReference);
const zeroAddress = "0x0000000000000000000000000000000000000000" as EvmAddress;
const sourceId = fdcIdentifier("testXRP");

function redemptionFixture(
  overrides: Partial<StoredRedemptionRequest> = {},
): StoredRedemptionRequest {
  return {
    assetManagerAddress,
    requestId: "4242",
    sourceChainId: "114",
    sourceBlockNumber: "1000",
    sourceLogIndex: "7",
    sourceTransactionHash,
    transactionHash: null,
    redeemer,
    agentVault,
    paymentAddress: "rDestinationAddress",
    valueUBA: 1_000_000n,
    feeUBA: 10_000n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: 300n,
    executor,
    executorFeeNatWei: 55n,
    status: "PROOF_READY",
    defaultTransactionHash: null,
    statusReason: null,
    redemptionKind: "STANDARD",
    destinationTag: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function xrpCalldataObject() {
  return {
    merkleProof: [proofNode],
    data: {
      attestationType: xrpPaymentNonexistenceAttestationType,
      sourceId,
      votingRound: "7",
      lowestUsedTimestamp: "1",
      requestBody: {
        minimalBlockNumber: "100",
        deadlineBlockNumber: "200",
        deadlineTimestamp: "300",
        destinationAddressHash,
        amount: "990000",
        checkFirstMemoData: true,
        firstMemoDataHash,
        checkDestinationTag: true,
        destinationTag: "777",
        proofOwner: zeroAddress,
      },
      responseBody: {
        minimalBlockTimestamp: "1",
        firstOverflowBlockNumber: "201",
        firstOverflowBlockTimestamp: "301",
      },
    },
  };
}

function standardCalldataObject() {
  return {
    merkleProof: [proofNode],
    data: {
      attestationType: fdcIdentifier("ReferencedPaymentNonexistence"),
      sourceId,
      votingRound: "7",
      lowestUsedTimestamp: "1",
      requestBody: {
        minimalBlockNumber: "100",
        deadlineBlockNumber: "200",
        deadlineTimestamp: "300",
        destinationAddressHash,
        amount: "990000",
        standardPaymentReference: paymentReference,
        checkSourceAddresses: false,
        sourceAddressesRoot: `0x${"00".repeat(32)}`,
      },
      responseBody: {
        minimalBlockTimestamp: "1",
        firstOverflowBlockNumber: "201",
        firstOverflowBlockTimestamp: "301",
      },
    },
  };
}

function proofFixture(
  calldataJson: string | null,
  overrides: Partial<StoredFdcProofRecord> = {},
): StoredFdcProofRecord {
  return {
    fdcProofId: "proof-1",
    fdcRequestId: "request-1",
    redemptionRequestId: "4242",
    assetManagerAddress,
    requestHash: `0x${"ab".repeat(32)}` as Bytes32,
    responseBody: "0x" as `0x${string}`,
    merkleProof: [proofNode],
    votingRoundId: 7n,
    proofJson: null,
    calldataJson,
    proofReadyAt: "2026-07-08T00:00:01.000Z" as IsoTimestamp,
    createdAt: "2026-07-08T00:00:01.000Z",
    ...overrides,
  };
}

describe("parseStoredXrpFdcProofCalldata", () => {
  test("parses a valid calldata JSON into the 10 request-body + 3 response-body tuple", () => {
    const parsed = parseStoredXrpFdcProofCalldata(
      proofFixture(JSON.stringify(xrpCalldataObject())),
    );

    assert.deepEqual(parsed.merkleProof, [proofNode]);
    assert.equal(parsed.data.attestationType, xrpPaymentNonexistenceAttestationType);
    assert.equal(parsed.data.sourceId, sourceId);
    assert.equal(parsed.data.votingRound, 7n);
    assert.equal(parsed.data.lowestUsedTimestamp, 1n);

    const rb = parsed.data.requestBody;
    assert.equal(rb.minimalBlockNumber, 100n);
    assert.equal(rb.deadlineBlockNumber, 200n);
    assert.equal(rb.deadlineTimestamp, 300n);
    assert.equal(rb.destinationAddressHash, destinationAddressHash);
    assert.equal(rb.amount, 990000n);
    assert.equal(rb.checkFirstMemoData, true);
    assert.equal(rb.firstMemoDataHash, firstMemoDataHash);
    assert.equal(rb.checkDestinationTag, true);
    assert.equal(rb.destinationTag, 777n);
    assert.equal(rb.proofOwner, zeroAddress);

    const responseBody = parsed.data.responseBody;
    assert.equal(responseBody.minimalBlockTimestamp, 1n);
    assert.equal(responseBody.firstOverflowBlockNumber, 201n);
    assert.equal(responseBody.firstOverflowBlockTimestamp, 301n);
  });

  test("throws when the calldata JSON is null", () => {
    assert.throws(
      () => parseStoredXrpFdcProofCalldata(proofFixture(null)),
      /has no calldata JSON/,
    );
  });

  test("throws with the field name when a required request-body field is missing", () => {
    const calldata = xrpCalldataObject();
    delete (calldata.data.requestBody as Record<string, unknown>).amount;
    assert.throws(
      () =>
        parseStoredXrpFdcProofCalldata(proofFixture(JSON.stringify(calldata))),
      /amount/,
    );
  });

  test("throws when a request-body field has the wrong type", () => {
    const calldata = xrpCalldataObject();
    (calldata.data.requestBody as Record<string, unknown>).checkFirstMemoData =
      "true";
    assert.throws(
      () =>
        parseStoredXrpFdcProofCalldata(proofFixture(JSON.stringify(calldata))),
      /checkFirstMemoData must be a boolean/,
    );
  });

  test("throws when merkleProof is not an array", () => {
    const calldata = xrpCalldataObject();
    (calldata as Record<string, unknown>).merkleProof = "not-an-array";
    assert.throws(
      () =>
        parseStoredXrpFdcProofCalldata(proofFixture(JSON.stringify(calldata))),
      /merkleProof must be an array/,
    );
  });

  test("round-trips a normalized XRP proof: normalize -> calldataJson -> parse yields identical fields", () => {
    const normalized = normalizeXrpPaymentNonexistenceProof({
      proof: [proofNode],
      response: {
        attestationType: xrpPaymentNonexistenceAttestationType,
        sourceId,
        votingRound: 7n,
        lowestUsedTimestamp: 1n,
        requestBody: {
          minimalBlockNumber: 100n,
          deadlineBlockNumber: 200n,
          deadlineTimestamp: 300n,
          destinationAddressHash,
          amount: 990000n,
          checkFirstMemoData: true,
          firstMemoDataHash,
          checkDestinationTag: true,
          destinationTag: 777n,
          proofOwner: zeroAddress,
        },
        responseBody: {
          minimalBlockTimestamp: 1n,
          firstOverflowBlockNumber: 201n,
          firstOverflowBlockTimestamp: 301n,
        },
      },
    });

    const parsed = parseStoredXrpFdcProofCalldata(
      proofFixture(normalized.calldataJson),
    );
    assert.deepEqual(parsed, normalized.proofCalldata);
  });
});

describe("buildExecuteDefaultParameters", () => {
  test("WITH_TAG routes to executeXrpDefault with the XRP proof and BigInt(requestId)", () => {
    const redemption = redemptionFixture({
      requestId: "4242",
      redemptionKind: "WITH_TAG",
      destinationTag: 777n,
    });
    const params = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: proofFixture(JSON.stringify(xrpCalldataObject())),
    });

    assert.equal(params.functionName, "executeXrpDefault");
    assert.equal(
      (params.address as string).toLowerCase(),
      harborRedeemerAddress.toLowerCase(),
    );
    if (params.functionName === "executeXrpDefault") {
      assert.equal(params.args[1], 4242n);
      assert.equal(params.args[0].data.requestBody.checkDestinationTag, true);
      assert.equal(params.args[0].data.requestBody.destinationTag, 777n);
      assert.equal(params.args[0].data.requestBody.checkFirstMemoData, true);
    }
  });

  test("STANDARD routes to executeDefault with the standard proof", () => {
    const redemption = redemptionFixture({
      requestId: "88",
      redemptionKind: "STANDARD",
      destinationTag: null,
    });
    const params = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: proofFixture(JSON.stringify(standardCalldataObject())),
    });

    assert.equal(params.functionName, "executeDefault");
    if (params.functionName === "executeDefault") {
      assert.equal(params.args[1], 88n);
      assert.equal(
        params.args[0].data.requestBody.standardPaymentReference,
        paymentReference,
      );
    }
  });

  test("account is added when supplied and omitted when absent", () => {
    const redemption = redemptionFixture({
      redemptionKind: "WITH_TAG",
      destinationTag: 777n,
    });
    const proof = proofFixture(JSON.stringify(xrpCalldataObject()));

    const withoutAccount = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof,
    });
    assert.equal("account" in withoutAccount, false);

    const withAccount = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof,
      account: keeperAccount,
    });
    assert.equal("account" in withAccount, true);
    assert.equal(
      (withAccount.account as string | undefined)?.toLowerCase(),
      keeperAccount.toLowerCase(),
    );
  });
});
