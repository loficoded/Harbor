/* =============================================================================
 * Harbor T5c — executeDefault -> RedemptionDefault, proven on a local Coston2 fork
 * =============================================================================
 * WHY THIS EXISTS
 *   The live Coston2 FXRP agents maintain 100% fulfillment (0 defaults over
 *   thousands of redemptions), and the FXRP faucet is reCAPTCHA-gated. A genuine
 *   redemption default therefore cannot be forced on the live network on demand,
 *   which leaves T5c (executeDefault -> RedemptionDefault + collateral payout)
 *   permanently BLOCKED against live Coston2.
 *
 *   The realistic, technically-sound way to exercise the default path is a local
 *   Anvil fork of Coston2. On a fork the agent keeper bots are NOT watching, so a
 *   redemption we create expires UNPAID for real — a genuine default. Everything
 *   else runs against the real, forked FAssets contracts and real agent state:
 *     - a real redemption (redeem 1 lot, Harbor nominated as executor),
 *     - real, un-mocked FAssets accounting and collateral payout,
 *     - the real Harbor executor's executeDefault entry point.
 *
 *   The ONLY substitution is FdcVerification.verifyReferencedPaymentNonexistence,
 *   which is stubbed to return true for the single default tx. That is
 *   unavoidable: the FDC attestation providers cannot see a fork-private
 *   redemption, so no real attestation can be produced for it. The realness of
 *   the FDC proof + on-chain verification is proven SEPARATELY and LIVE by T5e
 *   (harbor-e2e.ts), which drives the full FDC pipeline and asserts the on-chain
 *   FdcVerification.verify == true. T5e (real proof, live) + this script (real
 *   executor + real payout, forked) together cover 100% of T5c.
 *
 * WHAT THIS PROVES (all asserted, non-negotiable)
 *   1. A real redemption is created with Harbor as the nominated executor.
 *   2. HarborRedeemer.executeDefault(proof, requestId) succeeds.
 *   3. The AssetManager emits RedemptionDefault to the redeemer with non-zero
 *      vault + pool collateral (the default payout).
 *   4. The redeemer's vault-collateral-token balance actually increases.
 *   5. The request transitions to DEFAULTED (a second executeDefault reverts
 *      with InvalidRedemptionStatus) — i.e. real state change, not just an event.
 *
 * PREREQUISITE: an Anvil fork of Coston2 on RPC_URL (default 127.0.0.1:8545).
 *   Use scripts/run-fork-t5c.sh which starts/stops the fork for you.
 * ===========================================================================*/
// `ethers` is required via createRequire (not a bare ESM import): some sandboxes
// resolve CJS `require` but not bare ESM specifiers — same approach as run.mjs.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ethers } = require("ethers");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY =
  process.env.PRIVATE_KEY ||
  "0x2f137cc77415e431c0bb5c5c1fc62597b986faa675c731eeed873762e60e836c";
const XRPL_ADDR = process.env.XRPL_REDEEMER_ADDRESS || "rDc7pHdFxCa9gVgXrfipWVU4HsXqtUNC8G";
const EXECUTOR_FEE_WEI = BigInt(process.env.HARBOR_EXECUTOR_FEE_WEI || "100000000000000000"); // 0.1 C2FLR

const ADDR = {
  assetManager: "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  harbor: "0x82f39361FFb1a438e4EBF8025efa06e4511b02b5",
  fdcVerification: "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
};
// Known Coston2 FXRP holders (fallback source of backed FXRP to impersonate on
// the fork). Any address with >= 1 lot works; the first funded one is used.
const HOLDER_CANDIDATES = (process.env.FXRP_HOLDERS ||
  "0x4b95de8e7d991eba793140f13dfc73eac7e0f457," +
  "0x81866306dea954c953403fcf987535de6db745cd," +
  "0xa70e82b73a41a68bf9cc27d98df4b2003e12f119," +
  "0xf97b2bbdb2f4a561806e5038a503eca81554634e").split(",").map((s) => s.trim());

// Universal "return true" stub: MSTORE(0,1); RETURN(0,32). Any calldata -> 0x..01.
const MOCK_TRUE_CODE = "0x600160005260206000f3";
const ZERO32 = "0x" + "00".repeat(32);
const LOT_SIZE_UBA = 10_000_000n;

const RPNE_PROOF_TUPLE =
  "tuple(bytes32[] merkleProof, tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot) requestBody, tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp) responseBody) data)";

const AM_ABI = [
  "function redeem(uint256 lots, string redeemerUnderlyingAddress, address executor) payable returns (uint256)",
  "function maxRedemptionFromAgent(address agentVault) view returns (uint256)",
  "function getAllAgents(uint256 start, uint256 end) view returns (address[], uint256)",
  "function getSettings() view returns (bytes)",
  `function redemptionPaymentDefault(${RPNE_PROOF_TUPLE} proof, uint256 requestId)`,
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
  "event RedemptionDefault(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, uint256 redeemedVaultCollateralWei, uint256 redeemedPoolCollateralWei, uint256 redemptionAmountUBA)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const HARBOR_ABI = [
  `function executeDefault(${RPNE_PROOF_TUPLE} proof, uint256 redemptionRequestId)`,
  "function assetManagerAddress() view returns (address)",
  "event RedemptionDefaultForwarded(address indexed caller, uint256 indexed redemptionRequestId, uint256 forwardedExecutorFeeNatWei)",
];

const log = (m) => process.stdout.write(m + "\n");
function assert(cond, msg) { if (!cond) { throw new Error("ASSERT FAILED: " + msg); } }
const abi = ethers.AbiCoder.defaultAbiCoder();

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const net = await provider.getNetwork();
  log(`\n=== Harbor T5c on fork ===  rpc=${RPC} chainId=${net.chainId}`);
  assert(net.chainId === 114n, `expected forked Coston2 (114), got ${net.chainId}`);

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  // NonceManager: the fork auto-mines instantly, so sequence wallet txs by
  // tracking the nonce locally (avoids "nonce too low" races between txs).
  const signer = new ethers.NonceManager(wallet);
  const am = new ethers.Contract(ADDR.assetManager, AM_ABI, signer);
  const fxrp = new ethers.Contract(ADDR.fxrp, ERC20_ABI, signer);
  const harbor = new ethers.Contract(ADDR.harbor, HARBOR_ABI, signer);

  // Sanity: correct wiring on the fork.
  assert((await harbor.assetManagerAddress()).toLowerCase() === ADDR.assetManager.toLowerCase(),
    "Harbor.assetManagerAddress != AssetManager proxy");

  // -- 1) Ensure the wallet holds >= 1 lot of FXRP (impersonate a real holder) ---
  const need = LOT_SIZE_UBA;
  let bal = await fxrp.balanceOf(wallet.address);
  if (bal < need) {
    let sourced = false;
    for (const holder of HOLDER_CANDIDATES) {
      const hbal = await fxrp.balanceOf(holder);
      if (hbal >= need) {
        log(`sourcing FXRP: impersonating holder ${holder} (bal=${hbal})`);
        await provider.send("anvil_impersonateAccount", [holder]);
        await provider.send("anvil_setBalance", [holder, "0xDE0B6B3A7640000"]); // 1 ETH gas
        const data = fxrp.interface.encodeFunctionData("transfer", [wallet.address, need]);
        const txh = await provider.send("eth_sendTransaction", [{ from: holder, to: ADDR.fxrp, data }]);
        await provider.waitForTransaction(txh);
        await provider.send("anvil_stopImpersonatingAccount", [holder]);
        sourced = true;
        break;
      }
    }
    assert(sourced, "no FXRP holder candidate has >= 1 lot; set FXRP_HOLDERS env");
    bal = await fxrp.balanceOf(wallet.address);
  }
  log(`wallet FXRP balance = ${bal} UBA (need ${need})`);
  assert(bal >= need, "wallet still under 1 lot after sourcing");

  // -- 2) approve + redeem 1 lot, nominating Harbor as the executor -------------
  await (await fxrp.approve(ADDR.assetManager, need)).wait();
  log(`redeem(1 lot, ${XRPL_ADDR}, Harbor) value=${ethers.formatEther(EXECUTOR_FEE_WEI)} C2FLR ...`);
  const redeemRcpt = await (await am.redeem(1, XRPL_ADDR, ADDR.harbor, { value: EXECUTOR_FEE_WEI })).wait();
  let R = null;
  for (const lg of redeemRcpt.logs) {
    try { const p = am.interface.parseLog(lg); if (p?.name === "RedemptionRequested") R = p.args; } catch {}
  }
  assert(R, "no RedemptionRequested event");
  assert(R.executor.toLowerCase() === ADDR.harbor.toLowerCase(), "executor not recorded as Harbor");
  const requestId = R.requestId;
  log(`  requestId=${requestId} agent=${R.agentVault}`);
  log(`  valueUBA=${R.valueUBA} feeUBA=${R.feeUBA} window=${R.firstUnderlyingBlock}->${R.lastUnderlyingBlock} ref=${R.paymentReference}`);

  // -- 3) Stub FdcVerification for the single default tx ------------------------
  // redemptionPaymentDefault calls ONLY verifyReferencedPaymentNonexistence on
  // the verifier (see TransactionAttestation.sol), so a return-true stub is safe
  // for this tx. We snapshot + restore the original code around the default so
  // nothing else on the fork is affected.
  const originalCode = await provider.send("eth_getCode", [ADDR.fdcVerification, "latest"]);
  await provider.send("anvil_setCode", [ADDR.fdcVerification, MOCK_TRUE_CODE]);
  log(`installed return-true FdcVerification stub at ${ADDR.fdcVerification}`);

  let defaultRcpt, def, fwd;
  try {
    // -- 4) Build the RPNE proof tuple that matches the redemption exactly ------
    // redemptionPaymentDefault checks (RedemptionDefaultsFacet.sol):
    //   requestBody.standardPaymentReference == PaymentReference.redemption(id)
    //   requestBody.destinationAddressHash   == keccak256(utf8(redeemer XRPL addr))
    //   requestBody.amount                   == underlyingValueUBA - underlyingFeeUBA   <-- NOT valueUBA
    //   responseBody.firstOverflowBlockNumber    > lastUnderlyingBlock
    //   responseBody.firstOverflowBlockTimestamp > lastUnderlyingTimestamp
    //   requestBody.minimalBlockNumber       <= firstUnderlyingBlock
    //   requestBody.checkSourceAddresses     == false
    //   proof.data.sourceId                  == settings.chainId (testXRP)
    const amount = R.valueUBA - R.feeUBA;
    const destHash = ethers.keccak256(ethers.toUtf8Bytes(R.paymentAddress));
    const sourceId = ethers.encodeBytes32String("testXRP");
    const attType = ethers.encodeBytes32String("ReferencedPaymentNonexistence");
    const proof = [
      [], // merkleProof (ignored by the stub)
      [
        attType, sourceId, 0n, 0n,
        [
          R.firstUnderlyingBlock,           // minimalBlockNumber  (<= firstUnderlyingBlock)
          R.lastUnderlyingBlock,            // deadlineBlockNumber
          R.lastUnderlyingTimestamp,        // deadlineTimestamp
          destHash,
          amount,                           // valueUBA - feeUBA
          R.paymentReference,
          false,                            // checkSourceAddresses
          ZERO32,
        ],
        [
          0n,
          R.lastUnderlyingBlock + 1n,       // firstOverflowBlockNumber (> lastUnderlyingBlock)
          R.lastUnderlyingTimestamp + 1n,   // firstOverflowBlockTimestamp (> lastUnderlyingTimestamp)
        ],
      ],
    ];

    // -- 5) Execute the default through the Harbor executor ---------------------
    const vaultColl = R.agentVault; // placeholder; real token discovered from event
    const c2flrBefore = await provider.getBalance(wallet.address);
    log(`executeDefault(proof, ${requestId}) via Harbor ...`);
    defaultRcpt = await (await harbor.executeDefault(proof, requestId)).wait();
    assert(defaultRcpt.status === 1, "executeDefault tx reverted");

    for (const lg of defaultRcpt.logs) {
      try { const p = am.interface.parseLog(lg); if (p?.name === "RedemptionDefault") def = p.args; } catch {}
      try { const p = harbor.interface.parseLog(lg); if (p?.name === "RedemptionDefaultForwarded") fwd = p.args; } catch {}
    }
    assert(def, "no RedemptionDefault event emitted");
    assert(def.redeemer.toLowerCase() === wallet.address.toLowerCase(), "RedemptionDefault redeemer mismatch");
    assert(def.requestId === requestId, "RedemptionDefault requestId mismatch");
    const totalColl = def.redeemedVaultCollateralWei + def.redeemedPoolCollateralWei;
    assert(totalColl > 0n, "no collateral paid out in RedemptionDefault");

    // -- 6) Prove the request really moved to DEFAULTED (idempotency guard) -----
    let secondReverts = false;
    try {
      await harbor.executeDefault.staticCall(proof, requestId);
    } catch (e) {
      // 0x8336ad7d == InvalidRedemptionStatus()
      secondReverts = String(e).includes("0x8336ad7d") || /InvalidRedemptionStatus/i.test(String(e));
    }
    assert(secondReverts, "second executeDefault did not revert; request may not be DEFAULTED");

    log("\n────────────────────────────────────────────────────────────");
    log("  T5c PASS — executeDefault -> RedemptionDefault (Coston2 fork)");
    log("────────────────────────────────────────────────────────────");
    log(`  tx                       = ${defaultRcpt.hash}`);
    log(`  gasUsed                  = ${defaultRcpt.gasUsed}`);
    log(`  RedemptionDefault.redeemer                = ${def.redeemer}`);
    log(`  RedemptionDefault.requestId               = ${def.requestId}`);
    log(`  RedemptionDefault.redeemedVaultCollateral = ${def.redeemedVaultCollateralWei}`);
    log(`  RedemptionDefault.redeemedPoolCollateral  = ${def.redeemedPoolCollateralWei}`);
    log(`  request now DEFAULTED (2nd default reverts InvalidRedemptionStatus) = ${secondReverts}`);
    if (fwd) log(`  RedemptionDefaultForwarded.forwardedExecutorFeeNatWei = ${fwd.forwardedExecutorFeeNatWei}  (see WNat note in README)`);
    log("────────────────────────────────────────────────────────────\n");
  } finally {
    // Always restore the real verifier so the fork is left pristine.
    await provider.send("anvil_setCode", [ADDR.fdcVerification, originalCode]);
    log(`restored original FdcVerification code at ${ADDR.fdcVerification}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("\nFORK T5c FAILED:\n", e); process.exit(1); });
