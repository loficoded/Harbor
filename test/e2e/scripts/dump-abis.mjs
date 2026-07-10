// Bundle the Harbor protocol TS sources (type-only imports => safe to strip)
// and dump every ABI + address + chain constant to JSON for the standalone suite.
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const SRC = "/home/user/Harbor/packages/protocol/src";

const entry = `
export * from ${JSON.stringify(path.join(SRC, "abis.ts"))};
export * from ${JSON.stringify(path.join(SRC, "addresses.ts"))};
export * from ${JSON.stringify(path.join(SRC, "chains.ts"))};
`;

const result = await build({
  stdin: { contents: entry, resolveDir: SRC, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "warning",
});

const code = result.outputFiles[0].text;
const tmp = "/home/user/harbor-e2e/scripts/_bundle.mjs";
writeFileSync(tmp, code);
const mod = await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);

const wanted = [
  "referencedPaymentNonexistenceRequestBodyAbi",
  "referencedPaymentNonexistenceResponseBodyAbi",
  "referencedPaymentNonexistenceResponseAbi",
  "referencedPaymentNonexistenceProofAbi",
  "assetManagerEventsAbi",
  "assetManagerAbi",
  "fAssetAbi",
  "fdcHubAbi",
  "fdcRequestFeeConfigurationsAbi",
  "relayAbi",
  "flareContractRegistryAbi",
  "harborContractAbi",
  "coston2ProtocolAddresses",
  "coston2FxrpAsset",
  "coston2Chain",
];

const out = {};
for (const k of wanted) {
  if (!(k in mod)) { console.error("MISSING", k); continue; }
  out[k] = mod[k];
}

mkdirSync("/home/user/harbor-e2e/src", { recursive: true });
writeFileSync(
  "/home/user/harbor-e2e/src/harbor-abis.json",
  JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
console.log("dumped keys:", Object.keys(out).join(", "));
console.log("assetManagerAbi entries:", out.assetManagerAbi.length);
console.log("assetManagerEventsAbi entries:", out.assetManagerEventsAbi.length);
console.log("harborContractAbi entries:", out.harborContractAbi.length);
