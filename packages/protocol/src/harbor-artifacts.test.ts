import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HARBOR_REDEEMER_ADDRESS,
  harborRedeemerAbi,
  harborRedeemerAddress,
  harborRedeemerArtifactContractName,
  harborRedeemerArtifactPath,
  missingHarborRedeemerAbiFragments,
} from "./index.js";

describe("HarborRedeemer contract artifact exports", () => {
  test("exports the compiled HarborRedeemer ABI and placeholder address slot", () => {
    assert.equal(harborRedeemerArtifactContractName, "HarborRedeemer");
    assert.equal(
      harborRedeemerArtifactPath,
      "contracts/out/HarborRedeemer.sol/HarborRedeemer.json",
    );
    assert.equal(HARBOR_REDEEMER_ADDRESS, undefined);
    assert.equal(harborRedeemerAddress, HARBOR_REDEEMER_ADDRESS);
    assert.equal(harborRedeemerAbi.length > 0, true);
  });

  test("includes every HarborRedeemer fragment required by backend and frontend packages", () => {
    assert.deepEqual(missingHarborRedeemerAbiFragments(harborRedeemerAbi), []);
  });
});
