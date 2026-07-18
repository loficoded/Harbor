import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  destinationTagMax,
  emptyAgentDetails,
  hasAgentDetails,
  isRedemptionKind,
  normalizeAgentDetailField,
  normalizeDestinationTag,
  redemptionKinds,
  type AgentDetails,
} from "./index.js";

describe("agent details value object", () => {
  test("emptyAgentDetails has every field null", () => {
    assert.deepEqual(emptyAgentDetails, {
      name: null,
      description: null,
      iconUrl: null,
      termsOfUseUrl: null,
    });
  });

  describe("normalizeAgentDetailField", () => {
    test("returns the trimmed value for a non-empty string", () => {
      assert.equal(
        normalizeAgentDetailField("  Acme Redeemer  "),
        "Acme Redeemer",
      );
      assert.equal(
        normalizeAgentDetailField("https://example.com/icon.png"),
        "https://example.com/icon.png",
      );
    });

    test("collapses empty and whitespace-only strings to null", () => {
      assert.equal(normalizeAgentDetailField(""), null);
      assert.equal(normalizeAgentDetailField("   "), null);
      assert.equal(normalizeAgentDetailField("\t\n"), null);
    });

    test("treats a non-string (failed/absent read) as null", () => {
      assert.equal(normalizeAgentDetailField(undefined), null);
      assert.equal(normalizeAgentDetailField(null), null);
      assert.equal(normalizeAgentDetailField(42), null);
      assert.equal(normalizeAgentDetailField({}), null);
    });
  });

  describe("hasAgentDetails", () => {
    test("is false when every field is null", () => {
      assert.equal(hasAgentDetails(emptyAgentDetails), false);
    });

    test("is true when any single field is present", () => {
      const withName: AgentDetails = { ...emptyAgentDetails, name: "Acme" };
      const withIcon: AgentDetails = {
        ...emptyAgentDetails,
        iconUrl: "https://example.com/i.png",
      };
      const withDescription: AgentDetails = {
        ...emptyAgentDetails,
        description: "desc",
      };
      const withTerms: AgentDetails = {
        ...emptyAgentDetails,
        termsOfUseUrl: "https://example.com/terms",
      };

      assert.equal(hasAgentDetails(withName), true);
      assert.equal(hasAgentDetails(withIcon), true);
      assert.equal(hasAgentDetails(withDescription), true);
      assert.equal(hasAgentDetails(withTerms), true);
    });
  });
});

describe("redemption kind", () => {
  test("redemptionKinds lists the two lanes", () => {
    assert.deepEqual([...redemptionKinds], ["STANDARD", "WITH_TAG"]);
  });

  test("isRedemptionKind narrows the union", () => {
    assert.equal(isRedemptionKind("STANDARD"), true);
    assert.equal(isRedemptionKind("WITH_TAG"), true);
    assert.equal(isRedemptionKind("WITH-TAG"), false);
    assert.equal(isRedemptionKind(""), false);
  });

  test("destinationTagMax is 2**32 - 1", () => {
    assert.equal(destinationTagMax, 4294967295n);
    assert.equal(destinationTagMax, (1n << 32n) - 1n);
  });
});

describe("normalizeDestinationTag", () => {
  test("null/undefined/empty string mean no tag", () => {
    assert.equal(normalizeDestinationTag(null), null);
    assert.equal(normalizeDestinationTag(undefined), null);
    assert.equal(normalizeDestinationTag(""), null);
    assert.equal(normalizeDestinationTag("   "), null);
  });

  test("zero is a valid tag (not 'no tag')", () => {
    assert.equal(normalizeDestinationTag(0), 0n);
    assert.equal(normalizeDestinationTag(0n), 0n);
    assert.equal(normalizeDestinationTag("0"), 0n);
  });

  test("accepts the full uint32 range inclusive", () => {
    assert.equal(normalizeDestinationTag("1"), 1n);
    assert.equal(normalizeDestinationTag(4294967294), 4294967294n);
    assert.equal(normalizeDestinationTag(destinationTagMax), destinationTagMax);
    assert.equal(normalizeDestinationTag("4294967295"), destinationTagMax);
  });

  test("rejects values at or above 2**32", () => {
    assert.equal(normalizeDestinationTag(4294967296), null);
    assert.equal(normalizeDestinationTag("4294967296"), null);
    assert.equal(normalizeDestinationTag((1n << 32n) + 5n), null);
  });

  test("rejects negatives and non-integer strings", () => {
    assert.equal(normalizeDestinationTag(-1), null);
    assert.equal(normalizeDestinationTag(-1n), null);
    assert.equal(normalizeDestinationTag("abc"), null);
    assert.equal(normalizeDestinationTag("01"), null);
    assert.equal(normalizeDestinationTag(" 12x "), null);
    assert.equal(normalizeDestinationTag(1.5), null);
  });
});
