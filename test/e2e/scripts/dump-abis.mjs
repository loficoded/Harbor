// Bundle the Harbor protocol TS sources (type-only imports => safe to strip)
// and dump every ABI + address + chain constant to JSON for the standalone suite.
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const SRC = path.join(ROOT, "packages/protocol/src");

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
const tmp = path.join(ROOT, "test/e2e/scripts/_bundle.mjs");
writeFileSync(tmp, code);
const mod = await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);

const wanted = [
  "referencedPaymentNonexistenceRequestBodyAbi",
  "referencedPaymentNonexistenceResponseBodyAbi",
  "referencedPaymentNonexistenceResponseAbi",
  "referencedPaymentNonexistenceProofAbi",
  "xrpPaymentNonexistenceRequestBodyAbi",
  "xrpPaymentNonexistenceResponseBodyAbi",
  "xrpPaymentNonexistenceResponseAbi",
  "xrpPaymentNonexistenceProofAbi",
  "xrpPaymentResponseBodyAbi",
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
  if (!(k in mod)) {
    console.error("MISSING", k);
    continue;
  }
  out[k] = mod[k];
}

const OUT_DIR = path.join(ROOT, "test/e2e/src");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  path.join(OUT_DIR, "harbor-abis.json"),
  JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
console.log("dumped keys:", Object.keys(out).join(", "));
console.log("assetManagerAbi entries:", out.assetManagerAbi.length);
console.log("assetManagerEventsAbi entries:", out.assetManagerEventsAbi.length);
console.log("harborContractAbi entries:", out.harborContractAbi.length);
