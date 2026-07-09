import { RedemptionForm } from "@/components/redemption/redemption-form";
import {
  DEFAULT_FXRP_LOT_SIZE_UBA,
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

// The agent picker performs its own network fetch; stub it here so these tests
// focus on the transaction flow.
vi.mock("@/components/redemption/agent-picker", () => ({
  AgentPicker: () => null,
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
    const which =
      h.state.writeIndex === 0 ? h.state.approve : h.state.redeem;
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

async function fillForm() {
  await userEvent.type(screen.getByLabelText("Lots to redeem"), "1");
  await userEvent.type(
    screen.getByLabelText("XRPL destination address"),
    VALID_XRPL,
  );
}

describe("RedemptionForm transaction flow", () => {
  it("submits an approve transaction for the exact lot amount when allowance is short", async () => {
    h.state.allowance = 0n;
    render(<RedemptionForm />);
    await fillForm();

    const approve = screen.getByRole("button", { name: /approve fxrp/i });
    expect(approve).toBeEnabled();
    // Redeem is gated behind approval.
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();

    await userEvent.click(approve);

    expect(h.state.approve.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FXRP_TOKEN_ADDRESS,
        functionName: "approve",
        args: [FXRP_ASSET_MANAGER_ADDRESS, DEFAULT_FXRP_LOT_SIZE_UBA],
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
    await fillForm();

    expect(screen.getByText("Approving FXRP")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approving/i }),
    ).toBeDisabled();
  });

  it("submits a redeem transaction with the resolved executor when already approved", async () => {
    h.state.allowance = 10n ** 30n; // effectively unlimited
    render(<RedemptionForm />);
    await fillForm();

    // No approve step when already approved.
    expect(
      screen.queryByRole("button", { name: /approve fxrp/i }),
    ).toBeNull();

    const redeem = screen.getByRole("button", { name: "Redeem" });
    expect(redeem).toBeEnabled();
    await userEvent.click(redeem);

    expect(h.state.redeem.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FXRP_ASSET_MANAGER_ADDRESS,
        functionName: "redeem",
        // mock mode: no Harbor contract configured -> zero executor, zero fee.
        args: [1n, VALID_XRPL, zeroAddress],
        value: 0n,
      }),
    );
  });

  it("parses request ids from the receipt and routes to the status page", async () => {
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

    // Success state is shown and navigation is triggered from the receipt.
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
        logs: [
          redemptionRequestedLog(4207n),
          redemptionRequestedLog(4208n),
        ],
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
      error: new Error("execution reverted: agent unavailable"),
      writeContract: vi.fn(),
    } as never;

    render(<RedemptionForm />);
    await fillForm();

    expect(screen.getByText("Transaction failed")).toBeInTheDocument();
    expect(
      screen.getByText(/execution reverted: agent unavailable/i),
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
    await fillForm();

    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
    expect(screen.getByText(/wrong network/i)).toBeInTheDocument();
  });
});
