// Portable runner: esbuild-bundle harbor-e2e.ts (inlining the ABI JSON) and run
// it on Node. `ethers` is kept external so Node resolves it (works in sandboxes
// where bare ESM imports don't resolve but CJS require does). In a normal
// environment you can instead run:  npx tsx harbor-e2e.ts
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const res = await build({
  entryPoints: ["/home/user/harbor-e2e/harbor-e2e.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["ethers"],
  loader: { ".json": "json" },
  write: false,
  logLevel: "warning",
});
const outPath = "/home/user/harbor-e2e/dist.cjs";
writeFileSync(outPath, res.outputFiles[0].text);
await import(pathToFileURL(outPath).href);
