import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Bytes32, EvmAddress } from "@harbor/shared";

import {
  decodeXrpPaymentNonexistenceResponse,
  encodeXrpPaymentNonexistenceResponse,
  normalizeXrpPaymentNonexistenceProof,
  normalizeXrpPaymentNonexistenceResponse,
  type XrpPaymentNonexistenceResponseData,
} from "./daLayer.js";
import { fdcIdentifier } from "./referencedPaymentNonexistence.js";
import {
  standardFirstMemoDataHash,
  xrpPaymentNonexistenceAttestationType,
} from "./xrpPaymentNonexistence.js";

const attestationType = xrpPaymentNonexistenceAttestationType;
const sourceId = fdcIdentifier("testXRP");
const destinationAddressHash = `0x${"04".repeat(32)}` as Bytes32;
const firstMemoDataHash = standardFirstMemoDataHash(
  `0x${"dd".repeat(32)}` as Bytes32,
);
const proofOwner = "0x0000000000000000000000000000000000000000" as EvmAddress;

function sampleResponse(): XrpPaymentNonexistenceResponseData {
  return {
    attestationType,
    sourceId,
    votingRound: 1392000n,
    lowestUsedTimestamp: 1700000000n,
    requestBody: {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 300n,
      destinationAddressHash,
      amount: 999000n,
      checkFirstMemoData: true,
      firstMemoDataHash,
      checkDestinationTag: true,
      destinationTag: 12345n,
      proofOwner,
    },
    responseBody: {
      minimalBlockTimestamp: 101n,
      firstOverflowBlockNumber: 201n,
      firstOverflowBlockTimestamp: 301n,
    },
  };
}

describe("XRPPaymentNonexistence DA-layer encode/decode/normalize", () => {
  test("encode → decode → normalize round-trips every field exactly", () => {
    const original = sampleResponse();
    const encoded = encodeXrpPaymentNonexistenceResponse(original);
    const decoded = normalizeXrpPaymentNonexistenceResponse(
      decodeXrpPaymentNonexistenceResponse(encoded),
    );

    assert.deepEqual(decoded, original);
    assert.equal(decoded.requestBody.checkFirstMemoData, true);
    assert.equal(decoded.requestBody.checkDestinationTag, true);
    assert.equal(decoded.requestBody.destinationTag, 12345n);
    assert.equal(decoded.requestBody.proofOwner, proofOwner);
  });

  test("normalizeXrpPaymentNonexistenceProof accepts a DA-layer payload with response_hex", () => {
    const original = sampleResponse();
    const encoded = encodeXrpPaymentNonexistenceResponse(original);
    const merkleProof = [
      `0x${"01".repeat(32)}` as Bytes32,
      `0x${"02".repeat(32)}` as Bytes32,
    ];
    const payload = {
      proof: merkleProof,
      response_hex: encoded,
    };

    const normalized = normalizeXrpPaymentNonexistenceProof(payload);
    assert.deepEqual(normalized.proofCalldata.merkleProof, merkleProof);
    assert.deepEqual(normalized.proofCalldata.data, original);
    assert.equal(normalized.encodedResponse, encoded);
    // calldataJson is bigint-safe (strings, not numbers).
    const calldata = JSON.parse(normalized.calldataJson) as Record<
      string,
      unknown
    >;
    const data = calldata.data as Record<string, unknown>;
    const requestBody = data.requestBody as Record<string, unknown>;
    assert.equal(requestBody.destinationTag, "12345");
    assert.equal(requestBody.amount, "999000");
  });

  test("normalizeXrpPaymentNonexistenceProof accepts a decoded response object", () => {
    const original = sampleResponse();
    const merkleProof = [`0x${"03".repeat(32)}` as Bytes32];
    const payload = {
      proof: merkleProof,
      response: original,
    };

    const normalized = normalizeXrpPaymentNonexistenceProof(payload);
    assert.deepEqual(normalized.proofCalldata.data, original);
    assert.equal(
      normalized.encodedResponse,
      encodeXrpPaymentNonexistenceResponse(original),
    );
  });

  test("rejects a payload missing both response and response_hex", () => {
    assert.throws(
      () => normalizeXrpPaymentNonexistenceProof({ proof: [] }),
      /missing response/,
    );
  });
});
