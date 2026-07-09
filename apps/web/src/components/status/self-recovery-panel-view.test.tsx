import {
  SelfRecoveryPanelView,
  type SelfRecoveryPanelViewProps,
} from "@/components/status/self-recovery-panel-view";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Component tests for the pure self-recovery panel view. Each transaction
 * state — proof not ready, proof ready, wallet required, wrong network,
 * submitting, submitted, already recovered, and the unusable-proof /
 * unconfigured-contract edges — is rendered directly, no wagmi required.
 */

const SUBMIT = /submit default recovery/i;

function renderPanel(overrides: Partial<SelfRecoveryPanelViewProps> = {}) {
  const props: SelfRecoveryPanelViewProps = {
    phase: "ready",
    votingRoundId: "12345",
    fdcRequestStatus: "PROOF_READY",
    defaultTransactionHash: null,
    submittedTransactionHash: null,
    errorMessage: null,
    onSubmit: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SelfRecoveryPanelView {...props} />) };
}

describe("SelfRecoveryPanelView", () => {
  it("renders nothing when hidden", () => {
    const { container } = renderPanel({ phase: "hidden" });
    expect(container).toBeEmptyDOMElement();
  });

  it("proof not ready: disables submit and explains the backend is preparing it", () => {
    renderPanel({ phase: "proof-not-ready", votingRoundId: null });
    expect(screen.getByText(/still being prepared/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    // Permissionless explainer is present on actionable-track states.
    expect(screen.getByText(/permissionless/i)).toBeInTheDocument();
  });

  it("proof ready: enables submit and fires onSubmit", async () => {
    const onSubmit = vi.fn();
    renderPanel({ phase: "ready", onSubmit });
    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toBeEnabled();
    expect(screen.getByText(/executeDefault/)).toBeInTheDocument();

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("proof ready with an error: surfaces the failure and the front-run hint", () => {
    renderPanel({
      phase: "ready",
      errorMessage: "User rejected the request",
    });
    expect(screen.getByText("Transaction failed")).toBeInTheDocument();
    expect(screen.getByText("User rejected the request")).toBeInTheDocument();
    expect(
      screen.getByText(/already submitted the same proof/i),
    ).toBeInTheDocument();
  });

  it("wallet disconnected: disables submit and asks to connect", () => {
    renderPanel({ phase: "wallet-required" });
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
  });

  it("wrong network: disables submit and asks to switch to Coston2", () => {
    renderPanel({ phase: "wrong-network" });
    expect(
      screen.getByText(/switch your wallet to Coston2/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
  });

  it("contract unconfigured: shows the configuration notice and no submit button", () => {
    renderPanel({ phase: "contract-unconfigured" });
    expect(
      screen.getByText("Harbor contract not configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });

  it("proof invalid: shows the danger notice and a refresh action", async () => {
    const onRefresh = vi.fn();
    renderPanel({ phase: "proof-invalid", onRefresh });
    expect(
      screen.getByText("Proof cannot be submitted yet"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /refresh proof status/i }),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("submitting: shows the in-flight indicator and disables the button", () => {
    renderPanel({ phase: "submitting" });
    expect(screen.getByText("Submitting default recovery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();
  });

  it("submitted: confirms submission, notes front-running is harmless, links the tx, and refreshes", async () => {
    const onRefresh = vi.fn();
    renderPanel({
      phase: "submitted",
      submittedTransactionHash: `0x${"ab".repeat(32)}`,
      onRefresh,
    });
    expect(screen.getAllByText("Default submitted").length).toBeGreaterThan(0);
    expect(screen.getByText(/Front-running is harmless/i)).toBeInTheDocument();

    const txLink = screen.getByRole("link");
    expect(txLink).toHaveAttribute(
      "href",
      expect.stringContaining(`/tx/0x${"ab".repeat(32)}`),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /refresh status/i }),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("already recovered: shows the recovered confirmation and no submit button", () => {
    renderPanel({
      phase: "recovered",
      defaultTransactionHash: `0x${"cd".repeat(32)}`,
    });
    expect(screen.getAllByText("Recovered").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/released the\s+redemption collateral/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });
});
