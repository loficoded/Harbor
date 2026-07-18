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

describe("XRPPaymentNonexistence DA-layer field coverage and malformed payloads", () => {
  test("normalizes all 10 request-body and 3 response-body fields from a full payload", () => {
    const original = sampleResponse();
    const merkleProof = [
      `0x${"0a".repeat(32)}` as Bytes32,
      `0x${"0b".repeat(32)}` as Bytes32,
    ];
    const normalized = normalizeXrpPaymentNonexistenceProof({
      proof: merkleProof,
      response: original,
    });

    assert.deepEqual(normalized.proofCalldata.merkleProof, merkleProof);

    const rb = normalized.proofCalldata.data.requestBody;
    assert.equal(rb.minimalBlockNumber, 100n);
    assert.equal(rb.deadlineBlockNumber, 200n);
    assert.equal(rb.deadlineTimestamp, 300n);
    assert.equal(rb.destinationAddressHash, destinationAddressHash);
    assert.equal(rb.amount, 999000n);
    assert.equal(rb.checkFirstMemoData, true);
    assert.equal(rb.firstMemoDataHash, firstMemoDataHash);
    assert.equal(rb.checkDestinationTag, true);
    assert.equal(rb.destinationTag, 12345n);
    assert.equal(rb.proofOwner, proofOwner);

    const responseBody = normalized.proofCalldata.data.responseBody;
    assert.equal(responseBody.minimalBlockTimestamp, 101n);
    assert.equal(responseBody.firstOverflowBlockNumber, 201n);
    assert.equal(responseBody.firstOverflowBlockTimestamp, 301n);
  });

  test("serializes every bigint field of the calldata JSON as a string (bigint-safe)", () => {
    const normalized = normalizeXrpPaymentNonexistenceProof({
      proof: [`0x${"0c".repeat(32)}` as Bytes32],
      response: sampleResponse(),
    });
    const calldata = JSON.parse(normalized.calldataJson) as Record<
      string,
      unknown
    >;
    const data = calldata.data as Record<string, unknown>;
    const requestBody = data.requestBody as Record<string, unknown>;
    const responseBody = data.responseBody as Record<string, unknown>;

    assert.equal(data.votingRound, "1392000");
    assert.equal(data.lowestUsedTimestamp, "1700000000");
    assert.equal(requestBody.minimalBlockNumber, "100");
    assert.equal(requestBody.deadlineBlockNumber, "200");
    assert.equal(requestBody.deadlineTimestamp, "300");
    assert.equal(requestBody.amount, "999000");
    assert.equal(requestBody.destinationTag, "12345");
    assert.equal(typeof requestBody.amount, "string");
    assert.equal(responseBody.minimalBlockTimestamp, "101");
    assert.equal(responseBody.firstOverflowBlockNumber, "201");
    assert.equal(responseBody.firstOverflowBlockTimestamp, "301");
  });

  test("rejects a payload whose proof is not an array", () => {
    assert.throws(
      () =>
        normalizeXrpPaymentNonexistenceProof({ response: sampleResponse() }),
      /proof must be an array/,
    );
  });

  test("rejects a payload whose response is not an object", () => {
    assert.throws(
      () =>
        normalizeXrpPaymentNonexistenceProof({
          proof: [],
          response: "not-an-object",
        }),
      /must be an object/,
    );
  });

  test("rejects a response missing a required request-body field", () => {
    const original = sampleResponse();
    const { amount: _amount, ...requestBodyWithoutAmount } =
      original.requestBody;
    void _amount;
    const responseMissingAmount = {
      ...original,
      requestBody: requestBodyWithoutAmount,
    };

    assert.throws(
      () =>
        normalizeXrpPaymentNonexistenceProof({
          proof: [],
          response: responseMissingAmount,
        }),
      /amount is required/,
    );
  });

  test("rejects a request-body field of the wrong type", () => {
    const original = sampleResponse();
    const responseWrongType = {
      ...original,
      requestBody: { ...original.requestBody, checkFirstMemoData: "yes" },
    };

    assert.throws(
      () =>
        normalizeXrpPaymentNonexistenceProof({
          proof: [],
          response: responseWrongType,
        }),
      /checkFirstMemoData must be boolean/,
    );
  });

  test("encodes a decoded response object back to the exact hex it decodes from", () => {
    const original = sampleResponse();
    const encoded = encodeXrpPaymentNonexistenceResponse(original);
    const roundTripped = encodeXrpPaymentNonexistenceResponse(
      normalizeXrpPaymentNonexistenceResponse(
        decodeXrpPaymentNonexistenceResponse(encoded),
      ),
    );
    assert.equal(roundTripped, encoded);
  });
});
