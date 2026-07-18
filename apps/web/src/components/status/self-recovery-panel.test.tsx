import { SelfRecoveryPanel } from "@/components/status/self-recovery-panel";
import { deriveSelfRecovery } from "@/lib/redemption-status";
import { buildExecuteDefaultArgs } from "@/lib/self-recovery";
import {
  defaultSubmittedResponse,
  proofReadyResponse,
  recoveredResponse,
} from "@/test/redemption-status-fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked viem/wagmi transaction tests for the self-recovery container. wagmi
 * hooks are stubbed (mirroring the redemption-form test) so `executeDefault` is
 * exercised without a live wallet or chain.
 */

const REQUEST_ID = "4207";
const HARBOR_REDEEMER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const USER = "0x00000000000000000000000000000000000000b2" as const;
const DEFAULT_TX = `0x${"ab".repeat(32)}` as const;
const SUBMIT = /submit default recovery/i;

const h = vi.hoisted(() => {
  const state = {
    account: {
      address: undefined as `0x${string}` | undefined,
      isConnected: false,
      chainId: undefined as number | undefined,
    },
    write: {
      data: undefined as `0x${string}` | undefined,
      isPending: false,
      error: null as Error | null,
      writeContract: vi.fn(),
    },
    receipt: {
      data: undefined as unknown,
      isLoading: false,
      isSuccess: false,
      error: null as Error | null,
    },
  };
  return { state };
});

vi.mock("wagmi", () => ({
  useAccount: () => h.state.account,
  useWriteContract: () => h.state.write,
  useWaitForTransactionReceipt: (config: { hash?: `0x${string}` }) => {
    if (config.hash && config.hash === h.state.write.data) {
      return h.state.receipt;
    }
    return { data: undefined, isLoading: false, isSuccess: false, error: null };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.state.account = { address: USER, isConnected: true, chainId: 114 };
  h.state.write = {
    data: undefined,
    isPending: false,
    error: null,
    writeContract: vi.fn(),
  } as never;
  h.state.receipt = {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    error: null,
  };
});

function proofReadyInfo() {
  return deriveSelfRecovery(
    proofReadyResponse({ requestId: REQUEST_ID, validProof: true }),
  );
}

function renderPanel(
  info = proofReadyInfo(),
  overrides: {
    harborRedeemerAddress?: string | null;
    redemptionKind?: "STANDARD" | "WITH_TAG";
    onRecoveryRefresh?: () => void;
  } = {},
) {
  // Distinguish an explicitly-null address from "not provided" (?? would treat
  // an intentional null as absent and fall back to the configured address).
  const harborRedeemerAddress =
    "harborRedeemerAddress" in overrides
      ? (overrides.harborRedeemerAddress ?? null)
      : HARBOR_REDEEMER;
  return render(
    <SelfRecoveryPanel
      requestId={REQUEST_ID}
      selfRecovery={info}
      redemptionKind={
        "redemptionKind" in overrides ? overrides.redemptionKind : "STANDARD"
      }
      harborRedeemerAddress={harborRedeemerAddress}
      onRecoveryRefresh={overrides.onRecoveryRefresh}
    />,
  );
}

describe("SelfRecoveryPanel — executeDefault transaction", () => {
  it("submits executeDefault with the decoded proof and request id", async () => {
    renderPanel();

    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    // The exact calldata the keeper would build is what the UI submits.
    const expected = buildExecuteDefaultArgs(
      proofReadyInfo().proof,
      REQUEST_ID,
    );
    expect(expected.ok).toBe(true);
    if (!expected.ok) {
      return;
    }

    expect(h.state.write.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: HARBOR_REDEEMER,
        functionName: "executeDefault",
        args: expected.args,
      }),
    );
  });

  it("shows the submitting state while the transaction is in flight", () => {
    h.state.write = {
      data: DEFAULT_TX,
      isPending: false,
      error: null,
      writeContract: vi.fn(),
    } as never;
    h.state.receipt = {
      data: undefined,
      isLoading: true,
      isSuccess: false,
      error: null,
    };
    renderPanel();

    expect(screen.getByText("Submitting default recovery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
  });

  it("shows submitted and refreshes the status once the receipt confirms", () => {
    const onRecoveryRefresh = vi.fn();
    h.state.write = {
      data: DEFAULT_TX,
      isPending: false,
      error: null,
      writeContract: vi.fn(),
    } as never;
    h.state.receipt = {
      data: { status: "success" },
      isLoading: false,
      isSuccess: true,
      error: null,
    };
    renderPanel(proofReadyInfo(), { onRecoveryRefresh });

    expect(screen.getAllByText("Default submitted").length).toBeGreaterThan(0);
    // The confirmed default triggers a status refetch so RECOVERED is picked up.
    expect(onRecoveryRefresh).toHaveBeenCalled();
  });

  it("treats a backend-observed default (keeper/third party) as submitted", () => {
    renderPanel(deriveSelfRecovery(defaultSubmittedResponse()));
    expect(screen.getAllByText("Default submitted").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });

  it("shows recovered (no action) once the backend confirms recovery", () => {
    renderPanel(deriveSelfRecovery(recoveredResponse()));
    expect(screen.getAllByText("Recovered").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });

  it("disables submission when the wallet is disconnected", () => {
    h.state.account = {
      address: undefined,
      isConnected: false,
      chainId: undefined,
    };
    renderPanel();

    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
    expect(h.state.write.writeContract).not.toHaveBeenCalled();
  });

  it("disables submission on the wrong network", () => {
    h.state.account = { address: USER, isConnected: true, chainId: 1 };
    renderPanel();

    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    expect(
      screen.getByText(/switch your wallet to Coston2/i),
    ).toBeInTheDocument();
  });

  it("reports the contract as unconfigured when no address is set", () => {
    renderPanel(proofReadyInfo(), { harborRedeemerAddress: null });
    expect(
      screen.getByText("Harbor contract not configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });

  it("regression: self-recovery stays available even if the keeper is unhealthy", async () => {
    // The panel takes no keeper-health input, so keeper liveness cannot gate it.
    // A proof-ready redemption with a connected wallet is always submittable.
    renderPanel();
    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(h.state.write.writeContract).toHaveBeenCalledOnce();
  });
});
