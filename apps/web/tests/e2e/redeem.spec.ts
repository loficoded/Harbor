import { expect, test, type Route } from "@playwright/test";
import { redemptionRequestedLog } from "../../src/test/redemption-fixtures";

/**
 * Happy-path redemption E2E with a mocked wallet and mocked network. A fake
 * EIP-1193 provider is injected as `window.ethereum` (picked up by wagmi's
 * injected connector) and on-chain reads/receipts are served by intercepting
 * the Coston2 RPC endpoint. The tests drive the full UI: connect -> enter an
 * arbitrary FXRP amount (or, in the advanced lots mode, a lot count) + XRPL
 * address -> redeem -> receipt parsed -> navigate to the status route for the
 * emitted request id. They also assert that no agent-selection control exists
 * and that the FIFO explanatory copy is shown.
 */

const ADDRESS = "0x00000000000000000000000000000000000000b2";
const CHAIN_ID_HEX = "0x72"; // 114
const REDEEM_TX_HASH = `0x${"ab".repeat(32)}`;
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const VALID_XRPL = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const REQUEST_ID = 4207n;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

function uint256Hex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/** Injected EIP-1193 provider stub for wagmi's injected connector. */
function installMockWallet(config: {
  address: string;
  chainIdHex: string;
  txHash: string;
}) {
  const provider = {
    isMetaMask: true,
    request: async ({
      method,
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

test.describe("Redemption happy path", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installMockWallet, {
      address: ADDRESS,
      chainIdHex: CHAIN_ID_HEX,
      txHash: REDEEM_TX_HASH,
    });

    const log = redemptionRequestedLog(REQUEST_ID);
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

    // Mock the Coston2 JSON-RPC endpoint used by the read/receipt transport.
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
                // balanceOf -> 1000 FXRP (6 decimals)
                result = uint256Hex(1_000_000_000n);
              } else if (data.startsWith("0xdd62ed3e")) {
                // allowance -> effectively unlimited (already approved)
                result = uint256Hex(2n ** 256n - 1n);
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

    // Mock the Harbor backend agents endpoint.
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
          agents: [
            {
              agentVault: "0x00000000000000000000000000000000000000a1",
              score: 87,
              scoreIsHeuristic: true,
              availability: "AVAILABLE",
              availableLots: "12",
              collateralRatioBips: "20000",
              collateralRatioSource: "INVENTORY",
              updatedAt: "2026-01-01T00:00:00.000Z",
              formulaVersion: "v1",
              fulfillmentRate: 1,
              fulfillmentScore: 100,
              settlementTimeScore: 100,
              defaultPenalty: 0,
              availabilityScore: 100,
              collateralScore: 100,
              successfulRedemptions: 10,
              defaultedRedemptions: 0,
              totalTerminalRedemptions: 10,
              averageSettlementSeconds: 60,
            },
          ],
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
    // Once connected the truncated address is shown in the header.
    await expect(page.getByText(/0x0000…00b2/i)).toBeVisible();
  }

  test("redeems an arbitrary decimal amount and routes to the status page", async ({
    page,
  }) => {
    await connect(page);

    // The FIFO / no-agent-selection copy is shown, and there is no agent
    // selection control of any kind.
    await expect(
      page.getByText(
        /Agent selection is handled automatically by the FAssets protocol using FIFO/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/You do not choose a specific agent/i),
    ).toBeVisible();
    await expect(page.getByText(/preferred agent/i)).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /agent/i })).toHaveCount(0);

    // Amount is the primary input and accepts decimals.
    await page.getByLabel(/amount to redeem \(fxrp\)/i).fill("2.37");
    await expect(page.getByText(/Redeems 2.37 FXRP/)).toBeVisible();
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);

    // Already approved (allowance is unlimited), so redeem is enabled.
    const redeem = page.getByRole("button", { name: "Redeem" });
    await expect(redeem).toBeEnabled();
    await redeem.click();

    // Receipt parsed -> navigation to the status route for the request id, with
    // no agent carried in the URL.
    await page.waitForURL(/\/status\/4207/, { timeout: 30_000 });
    expect(page.url()).not.toContain("agent=");
    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();
    await expect(page.getByText("4207", { exact: false })).toBeVisible();
  });

  test("validates the FXRP amount (empty, zero, decimals, over-balance)", async ({
    page,
  }) => {
    await connect(page);
    const amount = page.getByLabel(/amount to redeem \(fxrp\)/i);
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);
    const redeem = page.getByRole("button", { name: "Redeem" });

    // Empty -> not ready.
    await expect(redeem).toBeDisabled();

    // Zero -> rejected.
    await amount.fill("0");
    await expect(page.getByText(/greater than zero/i).first()).toBeVisible();
    await expect(redeem).toBeDisabled();

    // Too many decimals (FXRP has 6) -> rejected.
    await amount.fill("1.1234567");
    await expect(
      page.getByText(/supports up to 6 decimal places/i).first(),
    ).toBeVisible();
    await expect(redeem).toBeDisabled();

    // Over balance (balance mock is 1000 FXRP) -> rejected.
    await amount.fill("100000");
    await expect(page.getByText(/insufficient/i).first()).toBeVisible();
    await expect(redeem).toBeDisabled();

    // A valid decimal amount clears the errors and enables redeem.
    await amount.fill("2.37");
    await expect(redeem).toBeEnabled();
  });

  test("supports the advanced whole-lot mode without any agent selection", async ({
    page,
  }) => {
    await connect(page);

    // Switch to the advanced lots mode.
    await page.getByRole("radio", { name: "Lots" }).click();
    await page.getByLabel("Lots to redeem").fill("1");
    // 1 lot == 10 FXRP for FXRP on Coston2.
    await expect(page.getByText(/Redeems 10 FXRP/)).toBeVisible();
    await page.getByLabel("XRPL destination address").fill(VALID_XRPL);

    // Still no agent-selection control in lots mode.
    await expect(page.getByText(/preferred agent/i)).toHaveCount(0);

    const redeem = page.getByRole("button", { name: "Redeem" });
    await expect(redeem).toBeEnabled();
    await redeem.click();

    await page.waitForURL(/\/status\/4207/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();
  });
});
