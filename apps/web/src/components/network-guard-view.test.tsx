import {
  NetworkGuardView,
  type NetworkGuardViewProps,
} from "@/components/network-guard-view";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const baseProps: NetworkGuardViewProps = {
  isConnected: true,
  currentChainId: 1,
  expectedChainId: 114,
  expectedChainName: "Flare Testnet Coston2",
  canSwitch: true,
  isSwitching: false,
  switchError: null,
  onSwitch: () => {},
};

describe("NetworkGuardView", () => {
  it("renders nothing when no wallet is connected", () => {
    const { container } = render(
      <NetworkGuardView {...baseProps} isConnected={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when already on the expected chain", () => {
    const { container } = render(
      <NetworkGuardView {...baseProps} currentChainId={114} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("warns and offers a switch action on the wrong chain", () => {
    render(<NetworkGuardView {...baseProps} />);

    expect(screen.getByText("Wrong network")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /switch to Flare Testnet Coston2/i }),
    ).toBeInTheDocument();
  });

  it("invokes onSwitch when the switch action is clicked", async () => {
    const onSwitch = vi.fn();
    render(<NetworkGuardView {...baseProps} onSwitch={onSwitch} />);

    await userEvent.click(screen.getByRole("button", { name: /switch to/i }));

    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("omits the switch action when the wallet cannot switch", () => {
    render(<NetworkGuardView {...baseProps} canSwitch={false} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/switch your wallet to/i)).toBeInTheDocument();
  });

  it("surfaces a switch error when present", () => {
    render(<NetworkGuardView {...baseProps} switchError="User rejected" />);

    expect(
      screen.getByText(/could not switch automatically/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/user rejected/i)).toBeInTheDocument();
  });
});
