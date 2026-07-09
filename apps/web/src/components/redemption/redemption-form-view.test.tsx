import {
  RedemptionFormView,
  type RedemptionFormViewProps,
} from "@/components/redemption/redemption-form-view";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const baseProps: RedemptionFormViewProps = {
  isConnected: true,
  correctNetwork: true,
  balanceLabel: "100",
  balanceLoading: false,
  lotInput: "1",
  onLotInputChange: () => {},
  lotError: null,
  amountLabel: "10",
  addressInput: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  onAddressChange: () => {},
  addressError: null,
  agentPicker: <div>agent-picker-slot</div>,
  executorFeeLabel: "0.1 C2FLR",
  executorLabel: "0x1234…5678",
  harborManaged: true,
  approvalRequired: false,
  approvalPending: false,
  redeemPending: false,
  blockedReason: null,
  errorMessage: null,
  submittedRequestIds: null,
  onApprove: () => {},
  onRedeem: () => {},
};

function renderView(overrides: Partial<RedemptionFormViewProps> = {}) {
  return render(<RedemptionFormView {...baseProps} {...overrides} />);
}

describe("RedemptionFormView", () => {
  it("shows the computed FXRP amount and balance", () => {
    renderView();
    expect(screen.getByText(/Redeems 10 FXRP/)).toBeInTheDocument();
    expect(screen.getByText(/100 FXRP/)).toBeInTheDocument();
    expect(screen.getByText("agent-picker-slot")).toBeInTheDocument();
    expect(screen.getByText("0.1 C2FLR")).toBeInTheDocument();
  });

  it("prompts to connect when no wallet is connected", () => {
    renderView({
      isConnected: false,
      balanceLabel: null,
      blockedReason: "Connect a wallet to redeem.",
    });
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a wallet to redeem."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("warns and disables actions on the wrong network", () => {
    renderView({
      correctNetwork: false,
      blockedReason: "Switch to Coston2 to redeem.",
    });
    expect(screen.getByText(/wrong network/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("shows an approve step and disables redeem when approval is required", () => {
    renderView({ approvalRequired: true });
    expect(
      screen.getByRole("button", { name: /approve fxrp/i }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("hides the approve step and enables redeem when already approved", () => {
    renderView({ approvalRequired: false });
    expect(
      screen.queryByRole("button", { name: /approve fxrp/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeEnabled();
  });

  it("renders a pending state while approving", () => {
    renderView({ approvalRequired: true, approvalPending: true });
    expect(
      screen.getByRole("button", { name: /approving/i }),
    ).toBeDisabled();
    expect(screen.getByText("Approving FXRP")).toBeInTheDocument();
  });

  it("renders a pending state while redeeming", () => {
    renderView({ redeemPending: true });
    expect(
      screen.getByRole("button", { name: /submitting/i }),
    ).toBeDisabled();
    expect(screen.getByText("Submitting redemption")).toBeInTheDocument();
  });

  it("renders a success state without claiming recovery is complete", () => {
    renderView({ submittedRequestIds: ["4207", "4208"] });
    expect(
      screen.getByText("Redemption request submitted"),
    ).toBeInTheDocument();
    expect(screen.getByText(/4207, 4208/)).toBeInTheDocument();
    expect(screen.getByText(/recovery is not complete/i)).toBeInTheDocument();
  });

  it("renders a failure state with the error message", () => {
    renderView({ errorMessage: "User rejected the request." });
    expect(screen.getByText("Transaction failed")).toBeInTheDocument();
    expect(
      screen.getByText("User rejected the request."),
    ).toBeInTheDocument();
  });

  it("shows an address validation error", () => {
    renderView({ addressError: "Enter a valid XRPL classic address." });
    expect(
      screen.getByText("Enter a valid XRPL classic address."),
    ).toBeInTheDocument();
  });

  it("invokes the action callbacks when enabled", async () => {
    const onApprove = vi.fn();
    const onRedeem = vi.fn();

    const { rerender } = renderView({ approvalRequired: true, onApprove });
    await userEvent.click(
      screen.getByRole("button", { name: /approve fxrp/i }),
    );
    expect(onApprove).toHaveBeenCalledOnce();

    rerender(
      <RedemptionFormView
        {...baseProps}
        approvalRequired={false}
        onRedeem={onRedeem}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(onRedeem).toHaveBeenCalledOnce();
  });
});
