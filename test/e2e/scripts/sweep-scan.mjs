// Fast, read-only reconnaissance sweep (Approach 1). Mirrors T5f's candidate
// logic but parallelizes the 30-block getLogs windows (Coston2 caps ranges at
// 30) to scan a wide window quickly. Reports Harbor-nominated, expired, unpaid
// redemptions (executable defaults) plus fulfillment stats for documentation.
import { ethers } from "ethers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ABIS = require("../src/harbor-abis.json");

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const HARBOR = "0xD2180a8A091A1B4652B48F33767A0d0483da5D50";
const LOOKBACK = Number(process.env.LOOKBACK || "150000");
const WIN = 30;            // RPC max block span per getLogs
const CONCURRENCY = 16;

const provider = new ethers.JsonRpcProvider(RPC, 114, { staticNetwork: true });
const iface = new ethers.Interface(ABIS.assetManagerEventsAbi);
const names = ["RedemptionRequested", "RedemptionPerformed", "RedemptionDefault", "RedemptionPaymentFailed", "RedemptionPaymentBlocked"];
const topics = names.map((n) => iface.getEvent(n).topicHash);

async function getLogsRetry(fromBlock, toBlock, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { return await provider.getLogs({ address: AM, topics: [topics], fromBlock, toBlock }); }
    catch (e) { if (i === tries - 1) return null; await new Promise((r) => setTimeout(r, 250 * (i + 1))); }
  }
}

const head = await provider.getBlockNumber();
const start = head - LOOKBACK;
console.log(`head=${head} scanning ${start}..${head} (${LOOKBACK} blocks) in ${WIN}-block windows, concurrency=${CONCURRENCY}`);

// Build window list
const windows = [];
for (let b = start; b <= head; b += WIN) windows.push([b, Math.min(b + WIN - 1, head)]);

const requested = new Map();   // requestId -> args
const terminalBy = new Map();  // requestId -> event name
let failedWindows = 0, done = 0;

for (let i = 0; i < windows.length; i += CONCURRENCY) {
  const batch = windows.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(([f, t]) => getLogsRetry(f, t)));
  for (const logs of results) {
    if (logs === null) { failedWindows++; continue; }
    for (const lg of logs) {
      let p; try { p = iface.parseLog({ topics: lg.topics, data: lg.data }); } catch { continue; }
      const id = p.args.requestId?.toString(); if (!id) continue;
      if (p.name === "RedemptionRequested") requested.set(id, p.args);
      else terminalBy.set(id, p.name);
    }
  }
  done += batch.length;
  if (done % 800 < CONCURRENCY) process.stdout.write(`  …scanned ${done}/${windows.length} windows\n`);
}

const now = Math.floor(Date.now() / 1000);
let harborNom = 0, defaults = 0, performed = 0, failedEv = 0, blocked = 0;
for (const name of terminalBy.values()) {
  if (name === "RedemptionDefault") defaults++;
  else if (name === "RedemptionPerformed") performed++;
  else if (name === "RedemptionPaymentFailed") failedEv++;
  else if (name === "RedemptionPaymentBlocked") blocked++;
}
const executorCounts = new Map();
for (const a of requested.values()) {
  const ex = (a.executor || ethers.ZeroAddress).toLowerCase();
  executorCounts.set(ex, (executorCounts.get(ex) || 0) + 1);
  if (ex === HARBOR.toLowerCase()) harborNom++;
}

// Non-terminal (open) redemptions
const open = [...requested.values()].filter((a) => !terminalBy.has(a.requestId.toString()));
// Candidates: Harbor-nominated, expired (window passed), still open
const candidates = open.filter(
  (a) => a.executor.toLowerCase() === HARBOR.toLowerCase() && now > Number(a.lastUnderlyingTimestamp),
);

console.log("\n===== SWEEP RESULTS =====");
console.log(`failed windows (RPC): ${failedWindows}`);
console.log(`RedemptionRequested seen: ${requested.size}`);
console.log(`  terminal: performed=${performed} default=${defaults} paymentFailed=${failedEv} paymentBlocked=${blocked}`);
console.log(`  Harbor-nominated (executor=${HARBOR}): ${harborNom}`);
console.log(`  open (non-terminal): ${open.length}`);
console.log("\nExecutor nomination breakdown (requestId count by executor):");
for (const [ex, c] of [...executorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`  ${ex}  ${c}`);

console.log("\nOpen (non-terminal) redemptions:");
for (const a of open.slice(0, 30)) {
  const expired = now > Number(a.lastUnderlyingTimestamp);
  const isHarbor = a.executor.toLowerCase() === HARBOR.toLowerCase();
  console.log(`  id=${a.requestId} executor=${a.executor} tsDeadline=${a.lastUnderlyingTimestamp} expired=${expired} harbor=${isHarbor}`);
}

console.log(`\n>>> EXECUTABLE Harbor-nominated expired-unpaid candidates: ${candidates.length}`);
for (const a of candidates) console.log(`  CANDIDATE id=${a.requestId} agent=${a.agentVault} value=${a.valueUBA} ref=${a.paymentReference}`);
import fs from "node:fs";
fs.writeFileSync("/home/user/sweep-candidates.json",
  JSON.stringify(candidates.map((a) => a.requestId.toString()), null, 2));
console.log("\nwrote /home/user/sweep-candidates.json");
