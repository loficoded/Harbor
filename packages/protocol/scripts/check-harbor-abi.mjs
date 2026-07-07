import {
  harborRedeemerAbi,
  missingHarborRedeemerAbiFragments,
} from "../dist/index.js";

const missingFragments = missingHarborRedeemerAbiFragments(harborRedeemerAbi);

if (missingFragments.length !== 0) {
  console.error(
    `HarborRedeemer ABI is missing required fragments: ${missingFragments.join(
      ", ",
    )}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "HarborRedeemer ABI includes all required backend/frontend fragments.",
  );
}
