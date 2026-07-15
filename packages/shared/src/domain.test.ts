import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  emptyAgentDetails,
  hasAgentDetails,
  normalizeAgentDetailField,
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
      assert.equal(normalizeAgentDetailField("  Acme Redeemer  "), "Acme Redeemer");
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
