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
  amountInput: "2.37",
  onAmountInputChange: () => {},
  amountError: null,
  amountLabel: "2.37",
  addressInput: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  onAddressChange: () => {},
  addressError: null,
  tagInput: "",
  onTagInputChange: () => {},
  tagError: null,
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
    expect(screen.getByLabelText(/amount \(fxrp\)/i)).toHaveValue("2.37");
    expect(screen.getByText(/Redeems 2.37 FXRP/)).toBeInTheDocument();
    expect(screen.getByText(/100 FXRP/)).toBeInTheDocument();
    expect(screen.getByText(/0.1 C2FLR/)).toBeInTheDocument();
  });

  it("associates a visible label with the amount input", () => {
    renderView();
    const input = screen.getByLabelText(/amount \(fxrp\)/i);
    // The visible <label> is wired to the input via htmlFor/id.
    expect(input).toHaveAttribute("id", "redeem-amount");
    expect(input).toHaveAttribute("inputmode", "decimal");
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

  it("has no Amount/Lots mode toggle or lot controls (amount-only)", () => {
    renderView();
    // The redemption-input-mode radiogroup and its radios are gone.
    expect(
      screen.queryByRole("radiogroup", { name: /redemption input mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: "Amount" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Lots" })).toBeNull();
    // No lot input, label, or helper copy remains anywhere in the form.
    expect(screen.queryByLabelText(/lots to redeem/i)).toBeNull();
    expect(screen.queryByText(/lots to redeem/i)).toBeNull();
    expect(screen.queryByText(/whole number of lots/i)).toBeNull();
    expect(screen.queryByText(/\blots?\b/i)).toBeNull();
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

describe("RedemptionFormView — destination tag (redeem-by-tag)", () => {
  it("renders an enabled tag input with the standard helper by default", () => {
    renderView();
    const tag = screen.getByLabelText("XRPL destination tag");
    expect(tag).toBeEnabled();
    expect(
      screen.getByText(/Required by exchanges\/custodials/i),
    ).toBeInTheDocument();
  });

  it("keeps the tag input enabled while capability is unknown (undefined)", () => {
    renderView({ tagSupported: undefined });
    expect(screen.getByLabelText("XRPL destination tag")).toBeEnabled();
  });

  it("gracefully disables the tag input when redeemWithTagSupported() is false", () => {
    renderView({ tagSupported: false });
    const tag = screen.getByLabelText("XRPL destination tag");
    expect(tag).toBeDisabled();
    expect(
      screen.getByText(/does not support destination-tag redemptions/i),
    ).toBeInTheDocument();
    // The normal helper copy is replaced by the graceful notice.
    expect(
      screen.queryByText(/Required by exchanges\/custodials/i),
    ).not.toBeInTheDocument();
  });

  it("forwards tag input changes to the handler", async () => {
    const onTagInputChange = vi.fn();
    renderView({ onTagInputChange });
    await userEvent.type(screen.getByLabelText("XRPL destination tag"), "9");
    expect(onTagInputChange).toHaveBeenCalledWith("9");
  });
});
