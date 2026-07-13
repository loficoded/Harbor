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
  mode: "amount",
  onModeChange: () => {},
  amountInput: "2.37",
  onAmountInputChange: () => {},
  amountError: null,
  lotInput: "",
  onLotInputChange: () => {},
  lotError: null,
  amountLabel: "2.37",
  addressInput: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  onAddressChange: () => {},
  addressError: null,
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

describe("RedemptionFormView — arbitrary amount (primary flow)", () => {
  it("shows the amount input, computed amount, and balance", () => {
    renderView();
    expect(screen.getByLabelText(/amount to redeem \(fxrp\)/i)).toHaveValue(
      "2.37",
    );
    expect(screen.getByText(/Redeems 2.37 FXRP/)).toBeInTheDocument();
    expect(screen.getByText(/100 FXRP/)).toBeInTheDocument();
    expect(screen.getByText(/0.1 C2FLR/)).toBeInTheDocument();
  });

  it("explains that any amount can be redeemed", () => {
    renderView();
    expect(
      screen.getByText(/FAssets supports redeeming any amount/i),
    ).toBeInTheDocument();
  });

  it("surfaces the FIFO / no-agent-selection notice", () => {
    renderView();
    expect(
      screen.getByText(
        /Agent selection is handled automatically by the FAssets protocol using FIFO/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You do not choose a specific agent/i),
    ).toBeInTheDocument();
  });

  it("has no agent-selection control", () => {
    renderView();
    // No preferred/select/choose-agent combobox exists in the form.
    expect(screen.queryByRole("combobox", { name: /agent/i })).toBeNull();
    for (const phrase of [
      /preferred agent/i,
      /choose (an |your )?agent/i,
      /select agent/i,
      /redeem with this agent/i,
    ]) {
      expect(screen.queryByText(phrase)).toBeNull();
    }
  });

  it("shows a decimal validation error", () => {
    renderView({
      amountError: "FXRP supports up to 6 decimal places.",
    });
    expect(
      screen.getByText("FXRP supports up to 6 decimal places."),
    ).toBeInTheDocument();
  });
});

describe("RedemptionFormView — input mode toggle", () => {
  it("exposes an Amount/Lots radiogroup with Amount active by default", () => {
    renderView();
    const group = screen.getByRole("radiogroup", {
      name: /redemption input mode/i,
    });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Amount" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Lots" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("invokes onModeChange when switching to lots", async () => {
    const onModeChange = vi.fn();
    renderView({ onModeChange });
    await userEvent.click(screen.getByRole("radio", { name: "Lots" }));
    expect(onModeChange).toHaveBeenCalledWith("lots");
  });

  it("renders the lot input and its computed amount in lots mode", () => {
    renderView({ mode: "lots", lotInput: "3", amountLabel: "30" });
    expect(screen.getByLabelText("Lots to redeem")).toHaveValue("3");
    expect(screen.getByText(/Redeems 30 FXRP/)).toBeInTheDocument();
    // The amount input is not shown while in lots mode.
    expect(screen.queryByLabelText(/amount to redeem \(fxrp\)/i)).toBeNull();
  });

  it("shows a lot validation error in lots mode", () => {
    renderView({
      mode: "lots",
      lotInput: "1.5",
      lotError: "Enter a whole number of lots.",
    });
    expect(
      screen.getByText("Enter a whole number of lots."),
    ).toBeInTheDocument();
  });
});

describe("RedemptionFormView — wallet, approval, and transaction states", () => {
  it("prompts to connect when no wallet is connected", () => {
    renderView({
      isConnected: false,
      balanceLabel: null,
      blockedReason: "Connect a wallet to redeem.",
    });
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
    expect(screen.getByText("Connect a wallet to redeem.")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /approve fxrp/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("hides the approve step and enables redeem when already approved", () => {
    renderView({ approvalRequired: false });
    expect(screen.queryByRole("button", { name: /approve fxrp/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeEnabled();
  });

  it("renders a pending state while approving", () => {
    renderView({ approvalRequired: true, approvalPending: true });
    expect(screen.getByRole("button", { name: /approving/i })).toBeDisabled();
    expect(screen.getByText("Approving FXRP")).toBeInTheDocument();
  });

  it("renders a pending state while redeeming", () => {
    renderView({ redeemPending: true });
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
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
    expect(screen.getByText("User rejected the request.")).toBeInTheDocument();
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
