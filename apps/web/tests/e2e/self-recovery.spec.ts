import { expect, test, type Page, type Route } from "@playwright/test";

import {
  proofReadyResponse,
  recoveredResponse,
} from "../../src/test/redemption-status-fixtures";

/**
 * Permissionless self-recovery E2E (Prompt #20). A mocked EIP-1193 wallet is
 * injected as `window.ethereum`, the Coston2 JSON-RPC endpoint is intercepted
 * for the receipt, and the Harbor backend serves an FDC-proof-ready redemption
 * that flips to recovered once the default transaction is observed. The test
 * drives the real `/status/[id]` route: connect -> submit `executeDefault` ->
 * recovered — with no keeper involvement.
 *
 * These run under both the desktop-chromium and mobile-chromium projects, so
 * each assertion doubles as a responsive check of the self-recovery panel.
 */

const REQUEST_ID = "5150";
const ADDRESS = "0x00000000000000000000000000000000000000b2";
const CHAIN_ID_HEX = "0x72"; // 114
const DEFAULT_TX_HASH = `0x${"5e".repeat(32)}`;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

/** Injected EIP-1193 provider stub for wagmi's injected connector. */
function installMockWallet(config: {
  address: string;
  chainIdHex: string;
  txHash: string;
}) {
  const provider = {
    isMetaMask: true,
    request: async ({ method }: { method: string }): Promise<unknown> => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [config.address];
        case "eth_chainId":
          return config.chainIdHex;
        case "net_version":
          return String(parseInt(config.chainIdHex, 16));
        case "wallet_switchEthereumChain":
          return null;
        case "eth_sendTransaction":
          return config.txHash;
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_blockNumber":
          return "0x120";
        default:
          return null;
      }
    },
    on: () => provider,
    removeListener: () => provider,
  };
  (window as unknown as { ethereum: unknown }).ethereum = provider;
}

type BackendOptions = Readonly<{
  /** Flip the redemption to RECOVERED once the default receipt is polled. */
  recoverOnReceipt: boolean;
  /** Serve an unhealthy keeper on /health (the UI must ignore it). */
  keeperUnhealthy?: boolean;
}>;

async function setupEnvironment(
  page: Page,
  options: BackendOptions,
): Promise<void> {
  await page.addInitScript(installMockWallet, {
    address: ADDRESS,
    chainIdHex: CHAIN_ID_HEX,
    txHash: DEFAULT_TX_HASH,
  });

  // Shared between the RPC and backend routes: the default is considered
  // observed (and the redemption recovered) once its receipt is polled.
  const observed = { recovered: false };

  const receipt = {
    transactionHash: DEFAULT_TX_HASH,
    transactionIndex: "0x0",
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: "0x100",
    from: ADDRESS,
    to: "0x00000000000000000000000000000000000000cc",
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    type: "0x2",
    effectiveGasPrice: "0x3b9aca00",
  };

  await page.route(
    "https://coston2-api.flare.network/**",
    async (route: Route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }

      const body = route.request().postDataJSON() as
        | { id: number; method: string; params?: unknown[] }
        | { id: number; method: string; params?: unknown[] }[];

      const handleOne = (req: { id: number; method: string }) => {
        let result: unknown = null;
        switch (req.method) {
          case "eth_chainId":
            result = CHAIN_ID_HEX;
            break;
          case "eth_blockNumber":
            result = "0x120";
            break;
          case "eth_getTransactionReceipt":
            // The default has now been observed on-chain; the indexer would
            // move the redemption to RECOVERED.
            if (options.recoverOnReceipt) {
              observed.recovered = true;
            }
            result = receipt;
            break;
          case "eth_getBlockByNumber":
            result = {
              number: "0x120",
              hash: `0x${"22".repeat(32)}`,
              parentHash: `0x${"00".repeat(32)}`,
              timestamp: "0x65000000",
              gasLimit: "0x1c9c380",
              gasUsed: "0x5208",
              miner: "0x00000000000000000000000000000000000000cc",
              baseFeePerGas: "0x3b9aca00",
              transactions: [],
            };
            break;
          default:
            result = null;
        }
        return { jsonrpc: "2.0", id: req.id, result };
      };

      const responseBody = Array.isArray(body)
        ? body.map(handleOne)
        : handleOne(body);

      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify(responseBody),
      });
    },
  );

  await page.route("http://localhost:3001/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }

    const url = route.request().url();

    // The status UI never calls /health, but a mocked unhealthy keeper makes
    // the regression scenario explicit: self-recovery must remain available.
    if (url.includes("/health")) {
      await route.fulfill({
        status: options.keeperUnhealthy ? 503 : 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          status: options.keeperUnhealthy ? "unhealthy" : "healthy",
          keeper: {
            status: options.keeperUnhealthy ? "STALLED" : "RUNNING",
          },
        }),
      });
      return;
    }

    const payload = observed.recovered
      ? recoveredResponse({ requestId: REQUEST_ID, validProof: true })
      : proofReadyResponse({ requestId: REQUEST_ID, validProof: true });

    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  });
}

async function connectWallet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /connect/i })
    .first()
    .click();
  // Once connected the truncated address is shown in the header.
  await expect(page.getByText(/0x0000…00b2/i)).toBeVisible();
}

test.describe("Self-recovery — permissionless default execution", () => {
  test("submits executeDefault and resolves to recovered", async ({ page }) => {
    await setupEnvironment(page, { recoverOnReceipt: true });
    await page.goto(`/status/${REQUEST_ID}`);

    await expect(
      page.getByRole("heading", { name: "Self-recovery" }),
    ).toBeVisible();

    await connectWallet(page);

    // Proof is ready and the wallet is on Coston2 -> the control is live.
    const submit = page.getByRole("button", {
      name: /submit default recovery/i,
    });
    await expect(submit).toBeEnabled();
    await submit.click();

    // After the default confirms on-chain and the indexer reports RECOVERED,
    // the panel resolves into the recovered state.
    await expect(
      page.getByText(/released the\s+redemption collateral/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Final")).toBeVisible();
  });

  test("regression: stays available and submittable when the keeper is unhealthy", async ({
    page,
  }) => {
    await setupEnvironment(page, {
      recoverOnReceipt: false,
      keeperUnhealthy: true,
    });
    await page.goto(`/status/${REQUEST_ID}`);
    await connectWallet(page);

    // Keeper health does not gate self-recovery: the control is fully live.
    const submit = page.getByRole("button", {
      name: /submit default recovery/i,
    });
    await expect(submit).toBeEnabled();
    await submit.click();

    // The submission goes through and the panel confirms it — no keeper needed.
    // Scope to the self-recovery panel's live confirmation callout (role=status):
    // "Default submitted" also appears as a timeline milestone and the phase
    // badge, so an unscoped text match is ambiguous under Playwright strict mode.
    await expect(
      page.getByRole("status").filter({ hasText: "Default submitted" }),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
});
