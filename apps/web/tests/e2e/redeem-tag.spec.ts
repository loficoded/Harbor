import { expect, test, type Route } from "@playwright/test";
import { redemptionWithTagRequestedLog } from "../../src/test/redemption-fixtures";
import { getFunctionSelector } from "viem";

/**
 * Redeem-by-tag E2E with a mocked wallet and mocked network. Mirrors
 * `redeem.spec.ts`. Covers exactly four flows:
 *   1. the destination-tag input renders and validates its uint32 bound;
 *   2. a present tag wires `AssetManager.redeemWithTag(amount, xrplAddress,
 *      executor, tag)` (never `redeemAmount`) and routes to `/status/{id}` from
 *      the emitted `RedemptionWithTagRequested` receipt;
 *   3. an empty tag falls back to the standard `redeemAmount` call;
 *   4. `redeemWithTagSupported() == false` gracefully disables the tag input
 *      while the standard lane still submits.
 */

const ADDRESS = "0x00000000000000000000000000000000000000b2";
const CHAIN_ID_HEX = "0x72"; // 114
const REDEEM_TX_HASH = `0x${"ab".repeat(32)}`;
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const VALID_XRPL = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const REQUEST_ID = 5100n;
const DESTINATION_TAG = 12345n;

const REDEEM_WITH_TAG_SELECTOR = getFunctionSelector(
  "redeemWithTag(uint256,string,address,uint256)",
);
const REDEEM_AMOUNT_SELECTOR = getFunctionSelector(
  "redeemAmount(uint256,string,address)",
);
const REDEEM_WITH_TAG_SUPPORTED_SELECTOR = getFunctionSelector(
  "redeemWithTagSupported()",
);

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

function uint256Hex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/** Captures every eth_sendTransaction call so the spec can assert calldata. */
function installMockWallet(config: {
  address: string;
  chainIdHex: string;
  txHash: string;
}) {
  const sentTransactions: {
    data?: string | undefined;
    value?: string | undefined;
  }[] = [];
  (window as unknown as { __sentTransactions: unknown }).__sentTransactions =
    sentTransactions;
  const provider = {
    isMetaMask: true,
    request: async ({
      method,
      params,
    }: {
      method: string;
      params?: unknown[];
    }): Promise<unknown> => {
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
        case "eth_sendTransaction": {
          const tx = (params?.[0] ?? {}) as { data?: string; value?: string };
          sentTransactions.push({ data: tx.data, value: tx.value });
          return config.txHash;
        }
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

test.describe("Redeem-by-tag", () => {
  // Mutable capability flag the RPC mock reads at request time so a single test
  // can exercise the `redeemWithTagSupported() == false` graceful-disable state.
  let redeemWithTagSupported = true;

  test.beforeEach(async ({ page }) => {
    redeemWithTagSupported = true;
    await page.addInitScript(installMockWallet, {
      address: ADDRESS,
      chainIdHex: CHAIN_ID_HEX,
      txHash: REDEEM_TX_HASH,
    });

    const log = redemptionWithTagRequestedLog(REQUEST_ID, {
      destinationTag: DESTINATION_TAG,
    });
    const receipt = {
      transactionHash: REDEEM_TX_HASH,
      transactionIndex: "0x0",
      blockHash: `0x${"11".repeat(32)}`,
      blockNumber: "0x100",
      from: ADDRESS,
      to: ASSET_MANAGER,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      contractAddress: null,
      logs: [
        {
          address: ASSET_MANAGER,
          topics: log.topics,
          data: log.data,
          blockNumber: "0x100",
          blockHash: `0x${"11".repeat(32)}`,
          transactionHash: REDEEM_TX_HASH,
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
        },
      ],
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

        const handleOne = (req: {
          id: number;
          method: string;
          params?: unknown[];
        }) => {
          let result: unknown = null;
          switch (req.method) {
            case "eth_chainId":
              result = CHAIN_ID_HEX;
              break;
            case "eth_blockNumber":
              result = "0x120";
              break;
            case "eth_call": {
              const call = (req.params?.[0] ?? {}) as { data?: string };
              const data = call.data ?? "";
              if (data.startsWith("0x70a08231")) {
                result = uint256Hex(1_000_000_000n); // 1000 FXRP
              } else if (data.startsWith("0xdd62ed3e")) {
                result = uint256Hex(2n ** 256n - 1n); // unlimited allowance
              } else if (data.startsWith(REDEEM_WITH_TAG_SUPPORTED_SELECTOR)) {
                // AssetManager.redeemWithTagSupported() -> bool capability.
                result = uint256Hex(redeemWithTagSupported ? 1n : 0n);
              } else {
                result = uint256Hex(0n);
              }
              break;
            }
            case "eth_getTransactionReceipt":
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
                miner: ASSET_MANAGER,
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
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          asset: "FXRP",
          scoreIsHeuristic: true,
          agents: [],
          generatedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
    });
  });

  async function connect(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page
      .getByRole("button", { name: /connect/i })
      .first()
      .click();
    await expect(page.getByText(/0x0000…00b2/i)).toBeVisible();
    // Wait for the initial on-chain reads (balance/allowance/tag-support) to
    // resolve. Filling controlled inputs before these settle can let a late
    // read-driven re-render revert the typed value — the root cause of the
    // earlier flaky "empty amount → disabled Redeem" routing failure.
    await expect(page.getByText(/1000 FXRP/).first()).toBeVisible();
  }

  /** Reads the mock wallet's captured `eth_sendTransaction` calldata. */
  async function sentTransactions(
    page: import("@playwright/test").Page,
  ): Promise<{ data?: string }[]> {
    return (await page.evaluate(
      () =>
        (window as unknown as { __sentTransactions: { data?: string }[] })
          .__sentTransactions,
    )) as { data?: string }[];
  }

  test("the destination-tag input renders and validates", async ({ page }) => {
    await connect(page);

    const tagInput = page.getByLabel("XRPL destination tag");
    await expect(tagInput).toBeVisible();

    // An out-of-range tag surfaces a validation error and disables redeem.
    await tagInput.fill("4294967296");
    await expect(tagInput).toHaveValue("4294967296");
    await expect(
      page.getByText(/destination tag must fit in 32 bits/i),
    ).toBeVisible();

    // A valid tag clears the error.
    await tagInput.fill("12345");
    await expect(tagInput).toHaveValue("12345");
    await expect(
      page.getByText(/destination tag must fit in 32 bits/i),
    ).toHaveCount(0);
  });

  test("a present tag wires redeemWithTag and routes to the status page", async ({
    page,
  }) => {
    await connect(page);

    await page.getByLabel(/amount \(fxrp\)/i).fill("10");
    // Sync point: wait for the parsed amount to commit before proceeding, so
    // the Redeem button deterministically enables (mirrors redeem.spec.ts).
    await expect(page.getByText(/Redeems 10 FXRP/i)).toBeVisible();
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);
    const tagInput = page.getByLabel("XRPL destination tag");
    await tagInput.fill("12345");
    await expect(tagInput).toHaveValue("12345");

    const redeem = page.getByRole("button", { name: "Redeem" });
    await expect(redeem).toBeEnabled();
    await redeem.click();

    // Routes to the status page for the request id emitted by the
    // RedemptionWithTagRequested receipt. waitForURL (30s) tolerates the real
    // send → receipt → navigate latency.
    await page.waitForURL(/\/status\/5100/, { timeout: 30_000 });

    // The sent transaction's calldata must be redeemWithTag (not redeemAmount).
    const sent = await sentTransactions(page);
    const redeemCall = sent.find((tx) =>
      tx.data?.startsWith(REDEEM_WITH_TAG_SELECTOR),
    );
    expect(redeemCall).toBeDefined();
    const standardCall = sent.find((tx) =>
      tx.data?.startsWith(REDEEM_AMOUNT_SELECTOR),
    );
    expect(standardCall).toBeUndefined();
  });

  test("an empty tag falls back to the standard redeemAmount call", async ({
    page,
  }) => {
    await connect(page);

    await page.getByLabel(/amount \(fxrp\)/i).fill("10");
    await expect(page.getByText(/Redeems 10 FXRP/i)).toBeVisible();
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);
    // Leave the destination tag empty.

    const redeem = page.getByRole("button", { name: "Redeem" });
    await expect(redeem).toBeEnabled();
    await redeem.click();

    // Wait for the wallet to capture the send before asserting calldata.
    await expect
      .poll(async () => (await sentTransactions(page)).length)
      .toBeGreaterThan(0);

    const sent = await sentTransactions(page);
    const standardCall = sent.find((tx) =>
      tx.data?.startsWith(REDEEM_AMOUNT_SELECTOR),
    );
    expect(standardCall).toBeDefined();
    const tagCall = sent.find((tx) =>
      tx.data?.startsWith(REDEEM_WITH_TAG_SELECTOR),
    );
    expect(tagCall).toBeUndefined();
  });

  test("gracefully disables the tag input when redeemWithTagSupported() is false", async ({
    page,
  }) => {
    // The AssetManager advertises no tag support for this session.
    redeemWithTagSupported = false;
    await connect(page);

    // The tag field is present (discoverable) but disabled, with a graceful
    // explanation instead of the normal helper copy.
    const tagInput = page.getByLabel("XRPL destination tag");
    await expect(tagInput).toBeVisible();
    await expect(tagInput).toBeDisabled();
    await expect(
      page.getByText(/does not support destination-tag redemptions/i),
    ).toBeVisible();

    // The standard lane still works end-to-end: a normal redeemAmount submits.
    await page.getByLabel(/amount \(fxrp\)/i).fill("10");
    await expect(page.getByText(/Redeems 10 FXRP/i)).toBeVisible();
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);

    const redeem = page.getByRole("button", { name: "Redeem" });
    await expect(redeem).toBeEnabled();
    await redeem.click();

    await expect
      .poll(async () => (await sentTransactions(page)).length)
      .toBeGreaterThan(0);
    const sent = await sentTransactions(page);
    expect(
      sent.find((tx) => tx.data?.startsWith(REDEEM_AMOUNT_SELECTOR)),
    ).toBeDefined();
    expect(
      sent.find((tx) => tx.data?.startsWith(REDEEM_WITH_TAG_SELECTOR)),
    ).toBeUndefined();
  });
});
