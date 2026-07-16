import { RedemptionForm } from "@/components/redemption/redemption-form";
import {
  FXRP_ASSET_MANAGER_ADDRESS,
  FXRP_TOKEN_ADDRESS,
} from "@/lib/redemption";
import { redemptionRequestedLog } from "@/test/redemption-fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_XRPL = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const USER = "0x00000000000000000000000000000000000000b2" as const;

// FXRP has 6 decimals, so 1 FXRP == 1_000_000 UBA and 2.37 FXRP == 2_370_000.
const ONE_FXRP_UBA = 1_000_000n;
const AMOUNT_2_37_UBA = 2_370_000n;

// Controllable wagmi/router state shared with the hoisted module mocks.
const h = vi.hoisted(() => {
  const makeWrite = () => ({
    data: undefined as `0x${string}` | undefined,
    isPending: false,
    error: null as Error | null,
    writeContract: vi.fn(),
  });

  const state = {
    account: {
      address: undefined as `0x${string}` | undefined,
      isConnected: false,
      chainId: undefined as number | undefined,
    },
    balance: undefined as bigint | undefined,
    allowance: undefined as bigint | undefined,
    refetchAllowance: undefined as unknown,
    approve: makeWrite(),
    redeem: makeWrite(),
    approveReceipt: {
      data: undefined as unknown,
      isLoading: false,
      isSuccess: false,
      error: null as Error | null,
    },
    redeemReceipt: {
      data: undefined as unknown,
      isLoading: false,
      isSuccess: false,
      error: null as Error | null,
    },
    writeIndex: 0,
  };

  return { state, push: undefined as unknown };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => {
    h.state.writeIndex = 0;
    return h.state.account;
  },
  useReadContract: (config: { functionName: string }) => {
    if (config.functionName === "balanceOf") {
      return { data: h.state.balance, isLoading: false, refetch: vi.fn() };
    }
    if (config.functionName === "allowance") {
      return {
        data: h.state.allowance,
        isLoading: false,
        refetch: h.state.refetchAllowance,
      };
    }
    return { data: undefined, isLoading: false, refetch: vi.fn() };
  },
  useWriteContract: () => {
    const which = h.state.writeIndex === 0 ? h.state.approve : h.state.redeem;
    h.state.writeIndex += 1;
    return which;
  },
  useWaitForTransactionReceipt: (config: { hash?: `0x${string}` }) => {
    if (config.hash && config.hash === h.state.approve.data) {
      return h.state.approveReceipt;
    }
    if (config.hash && config.hash === h.state.redeem.data) {
      return h.state.redeemReceipt;
    }
    return { data: undefined, isLoading: false, isSuccess: false, error: null };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.push = vi.fn();
  h.state.account = {
    address: USER,
    isConnected: true,
    chainId: 114,
  };
  h.state.balance = 1_000_000_000n; // plenty
  h.state.allowance = 0n;
  h.state.refetchAllowance = vi.fn();
  h.state.approve = {
    data: undefined,
    isPending: false,
    error: null,
    writeContract: vi.fn(),
  } as never;
  h.state.redeem = {
    data: undefined,
    isPending: false,
    error: null,
    writeContract: vi.fn(),
  } as never;
  h.state.approveReceipt = {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    error: null,
  };
  h.state.redeemReceipt = {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    error: null,
  };
  h.state.writeIndex = 0;
});

async function fillAmountForm(amount = "1") {
  await userEvent.type(screen.getByLabelText(/amount \(fxrp\)/i), amount);
  await userEvent.type(
    screen.getByLabelText("XRPL destination address"),
    VALID_XRPL,
  );
}

describe("RedemptionForm — arbitrary amount flow", () => {
  it("submits an approve transaction for the exact amount when allowance is short", async () => {
    h.state.allowance = 0n;
    render(<RedemptionForm />);
    await fillAmountForm("1");

    const approve = screen.getByRole("button", { name: /approve fxrp/i });
    expect(approve).toBeEnabled();
    // Redeem is gated behind approval.
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();

    await userEvent.click(approve);

    expect(h.state.approve.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FXRP_TOKEN_ADDRESS,
        functionName: "approve",
        args: [FXRP_ASSET_MANAGER_ADDRESS, ONE_FXRP_UBA],
      }),
    );
  });

  it("shows a pending state while the approval is in flight", async () => {
    h.state.allowance = 0n;
    h.state.approve = {
      data: "0xapprovehash",
      isPending: false,
      error: null,
      writeContract: vi.fn(),
    } as never;
    h.state.approveReceipt = {
      data: undefined,
      isLoading: true,
      isSuccess: false,
      error: null,
    };

    render(<RedemptionForm />);
    await fillAmountForm("1");

    expect(screen.getByText("Approving FXRP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approving/i })).toBeDisabled();
  });

  it("submits a redeemAmount transaction for a decimal amount when already approved", async () => {
    h.state.allowance = 10n ** 30n; // effectively unlimited
    render(<RedemptionForm />);
    await fillAmountForm("2.37");

    // No approve step when already approved.
    expect(screen.queryByRole("button", { name: /approve fxrp/i })).toBeNull();

    const redeem = screen.getByRole("button", { name: "Redeem" });
    expect(redeem).toBeEnabled();
    await userEvent.click(redeem);

    expect(h.state.redeem.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FXRP_ASSET_MANAGER_ADDRESS,
        // Arbitrary amount uses redeemAmount with the exact UBA amount.
        functionName: "redeemAmount",
        // mock mode: no Harbor contract configured -> zero executor, zero fee.
        args: [AMOUNT_2_37_UBA, VALID_XRPL, zeroAddress],
        value: 0n,
      }),
    );
  });

  it("rejects an amount with too many decimals before submission", async () => {
    h.state.allowance = 10n ** 30n;
    render(<RedemptionForm />);
    await fillAmountForm("1.1234567"); // 7 dp > FXRP's 6

    // The error is surfaced both inline under the field and in the blocked-
    // reason line beneath the actions.
    expect(
      screen.getAllByText(/supports up to 6 decimal places/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("normalizes trailing/leading zeros into the exact UBA amount", async () => {
    h.state.allowance = 10n ** 30n;
    render(<RedemptionForm />);
    // "02.370" is the same value as "2.37" -> 2_370_000 UBA.
    await fillAmountForm("02.370");

    const redeem = screen.getByRole("button", { name: "Redeem" });
    await userEvent.click(redeem);

    expect(h.state.redeem.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "redeemAmount",
        args: [AMOUNT_2_37_UBA, VALID_XRPL, zeroAddress],
      }),
    );
  });

  it("approves the exact decimal amount, not a rounded or whole value", async () => {
    h.state.allowance = 0n;
    render(<RedemptionForm />);
    await fillAmountForm("2.37");

    await userEvent.click(
      screen.getByRole("button", { name: /approve fxrp/i }),
    );

    expect(h.state.approve.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FXRP_TOKEN_ADDRESS,
        functionName: "approve",
        args: [FXRP_ASSET_MANAGER_ADDRESS, AMOUNT_2_37_UBA],
      }),
    );
  });

  it("keeps redeem disabled with a prompt until an amount is entered", async () => {
    h.state.allowance = 10n ** 30n;
    render(<RedemptionForm />);
    await userEvent.type(
      screen.getByLabelText("XRPL destination address"),
      VALID_XRPL,
    );

    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
    expect(screen.getByText(/enter an amount to redeem/i)).toBeInTheDocument();
  });

  it("treats a balance exactly equal to the amount as sufficient", async () => {
    h.state.allowance = 10n ** 30n;
    h.state.balance = AMOUNT_2_37_UBA; // exactly the required amount
    render(<RedemptionForm />);
    await fillAmountForm("2.37");

    expect(screen.getByRole("button", { name: "Redeem" })).toBeEnabled();
    expect(screen.queryByText(/insufficient/i)).toBeNull();
  });

  it("is amount-only: no mode toggle and it never calls the whole-lot redeem", async () => {
    h.state.allowance = 10n ** 30n;
    render(<RedemptionForm />);

    // The Amount/Lots toggle is gone entirely.
    expect(
      screen.queryByRole("radiogroup", { name: /redemption input mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: "Lots" })).toBeNull();
    expect(screen.queryByLabelText(/lots to redeem/i)).toBeNull();

    await fillAmountForm("2.37");
    await userEvent.click(screen.getByRole("button", { name: "Redeem" }));

    // Only the arbitrary-amount function is ever invoked — never whole-lot redeem.
    expect(h.state.redeem.writeContract).toHaveBeenCalledTimes(1);
    expect(h.state.redeem.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "redeemAmount" }),
    );
    expect(h.state.redeem.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "redeem" }),
    );
  });
});

describe("RedemptionForm — receipt routing and error states", () => {
  it("parses request ids from the receipt and routes to the status page (no agent in route)", async () => {
    h.state.allowance = 10n ** 30n;
    h.state.redeem = {
      data: "0xredeemhash",
      isPending: false,
      error: null,
      writeContract: vi.fn(),
    } as never;
    h.state.redeemReceipt = {
      data: {
        transactionHash: "0xredeemhash",
        logs: [redemptionRequestedLog(4207n)],
      },
      isLoading: false,
      isSuccess: true,
      error: null,
    };

    render(<RedemptionForm />);

    expect(
      await screen.findByText("Redemption request submitted"),
    ).toBeInTheDocument();
    expect(screen.getByText(/4207/)).toBeInTheDocument();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith("/status/4207?tx=0xredeemhash");
  });

  it("preserves multiple request ids in the status route", async () => {
    h.state.allowance = 10n ** 30n;
    h.state.redeem = {
      data: "0xredeemhash",
      isPending: false,
      error: null,
      writeContract: vi.fn(),
    } as never;
    h.state.redeemReceipt = {
      data: {
        transactionHash: "0xredeemhash",
        logs: [redemptionRequestedLog(4207n), redemptionRequestedLog(4208n)],
      },
      isLoading: false,
      isSuccess: true,
      error: null,
    };

    render(<RedemptionForm />);

    expect(
      await screen.findByText("Redemption request submitted"),
    ).toBeInTheDocument();
    expect(h.push).toHaveBeenCalledWith(
      "/status/4207?more=4208&tx=0xredeemhash",
    );
  });

  it("renders a failure state when the redeem transaction errors", async () => {
    h.state.allowance = 10n ** 30n;
    h.state.redeem = {
      data: undefined,
      isPending: false,
      error: new Error("execution reverted: redemption amount too small"),
      writeContract: vi.fn(),
    } as never;

    render(<RedemptionForm />);
    await fillAmountForm("2.37");

    expect(screen.getByText("Transaction failed")).toBeInTheDocument();
    expect(
      screen.getByText(/execution reverted: redemption amount too small/i),
    ).toBeInTheDocument();
  });

  it("disables the redeem action when the wallet is disconnected", async () => {
    h.state.account = {
      address: undefined,
      isConnected: false,
      chainId: undefined,
    };
    render(<RedemptionForm />);

    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
    expect(screen.getByText("Connect a wallet to redeem.")).toBeInTheDocument();
  });

  it("disables the redeem action on the wrong network", async () => {
    h.state.account = {
      address: USER,
      isConnected: true,
      chainId: 1,
    };
    h.state.allowance = 10n ** 30n;
    render(<RedemptionForm />);
    await fillAmountForm("2.37");

    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
    expect(screen.getByText(/wrong network/i)).toBeInTheDocument();
  });
});
