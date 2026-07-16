import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agentOwnerRegistryAbi,
  iAgentOwnerRegistryAbi,
  type AbiFragment,
  type AbiFunctionFragment,
} from "./index.js";

/**
 * Find a function fragment by name in the AgentOwnerRegistry ABI. The ABI is
 * declared `as const`, so it is widened to the general `AbiFragment[]` shape
 * before searching; that keeps the `AbiFunctionFragment` type guard valid (the
 * predicate type must be assignable to the element type).
 */
function functionFragment(name: string): AbiFunctionFragment {
  const fragments: readonly AbiFragment[] = agentOwnerRegistryAbi;
  const fragment = fragments.find(
    (item): item is AbiFunctionFragment =>
      item.type === "function" && item.name === name,
  );
  assert.ok(fragment, `expected AgentOwnerRegistry ABI to define ${name}`);
  return fragment;
}

describe("AgentOwnerRegistry ABI", () => {
  test("exposes the alias for the interface name", () => {
    assert.equal(iAgentOwnerRegistryAbi, agentOwnerRegistryAbi);
  });

  test("defines the four official agent-detail getters from the Flare spec", () => {
    for (const name of [
      "getAgentName",
      "getAgentDescription",
      "getAgentIconUrl",
      "getAgentTermsOfUseUrl",
    ]) {
      const fragment = functionFragment(name);

      assert.equal(fragment.stateMutability, "view");
      assert.equal(fragment.inputs.length, 1);
      assert.equal(fragment.inputs[0]?.type, "address");
      assert.equal(fragment.inputs[0]?.name, "_managementAddress");
      assert.equal(fragment.outputs.length, 1);
      assert.equal(fragment.outputs[0]?.type, "string");
    }
  });

  test("defines the management/work address mapping getters", () => {
    const work = functionFragment("getWorkAddress");
    assert.equal(work.inputs[0]?.name, "_managementAddress");
    assert.equal(work.outputs[0]?.type, "address");

    const management = functionFragment("getManagementAddress");
    assert.equal(management.inputs[0]?.name, "_workAddress");
    assert.equal(management.outputs[0]?.type, "address");
  });
});
