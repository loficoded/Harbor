import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agentOwnerRegistryAbi,
  iAgentOwnerRegistryAbi,
  type AbiFunctionFragment,
} from "./index.js";

function functionFragment(name: string): AbiFunctionFragment {
  const fragment = agentOwnerRegistryAbi.find(
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
