import { AgentIdentity } from "@/components/agents/agent-identity";
import { formatAddress } from "@/lib/format";
import { agentDetails } from "@/test/agents-fixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// A vault whose first hex character is a letter, so the monogram fallback and
// its uppercasing are observable.
const VAULT = "0xabc0000000000000000000000000000000000def";

describe("AgentIdentity", () => {
  it("renders the official name and icon when both are available", () => {
    render(
      <AgentIdentity
        details={agentDetails({
          name: "Acme Redeemer",
          iconUrl: "https://example.com/acme.png",
        })}
        agentVault={VAULT}
      />,
    );

    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      "Acme Redeemer",
    );

    const icon = screen.getByTestId("agent-identity-icon");
    expect(icon).toHaveAttribute("src", "https://example.com/acme.png");
    // The icon carries descriptive alt text for assistive technologies.
    expect(icon).toHaveAttribute("alt", "Acme Redeemer agent icon");

    // The vault address is shown beneath the official name for verification.
    expect(screen.getByTestId("agent-identity-address")).toHaveTextContent(
      formatAddress(VAULT),
    );

    // No monogram fallback while the icon is present.
    expect(screen.queryByTestId("agent-identity-monogram")).toBeNull();
  });

  it("falls back to a monogram when a named agent has no icon", () => {
    render(
      <AgentIdentity
        details={agentDetails({ name: "Acme Redeemer" })}
        agentVault={VAULT}
      />,
    );

    expect(screen.queryByTestId("agent-identity-icon")).toBeNull();

    const monogram = screen.getByTestId("agent-identity-monogram");
    expect(monogram).toHaveTextContent("A");
    // The monogram is decorative and hidden from assistive technologies.
    expect(monogram).toHaveAttribute("aria-hidden", "true");

    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      "Acme Redeemer",
    );
  });

  it("falls back to the vault address and vault monogram when unnamed", () => {
    render(<AgentIdentity details={agentDetails()} agentVault={VAULT} />);

    // The primary label is the truncated vault address.
    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      formatAddress(VAULT),
    );
    // No secondary address line: the address is already the primary label.
    expect(screen.queryByTestId("agent-identity-address")).toBeNull();
    // The monogram uses the first hex character of the vault, uppercased.
    expect(screen.getByTestId("agent-identity-monogram")).toHaveTextContent(
      "A",
    );
  });

  it("renders an icon with an address-based alt for an unnamed agent", () => {
    render(
      <AgentIdentity
        details={agentDetails({ iconUrl: "https://example.com/anon.png" })}
        agentVault={VAULT}
      />,
    );

    const icon = screen.getByTestId("agent-identity-icon");
    expect(icon).toHaveAttribute("src", "https://example.com/anon.png");
    expect(icon).toHaveAttribute("alt", `Agent ${VAULT} icon`);
    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      formatAddress(VAULT),
    );
  });

  it("falls back to the monogram when the icon fails to load", () => {
    render(
      <AgentIdentity
        details={agentDetails({
          name: "Acme Redeemer",
          iconUrl: "https://example.com/broken.png",
        })}
        agentVault={VAULT}
      />,
    );

    const icon = screen.getByTestId("agent-identity-icon");
    expect(icon).toBeInTheDocument();
    expect(screen.queryByTestId("agent-identity-monogram")).toBeNull();

    // Simulate the browser failing to load the image.
    fireEvent.error(icon);

    // The broken icon is replaced by the monogram fallback.
    expect(screen.queryByTestId("agent-identity-icon")).toBeNull();
    expect(screen.getByTestId("agent-identity-monogram")).toHaveTextContent(
      "A",
    );
  });

  it("rejects an unsafe (non-http) icon URL and shows the monogram", () => {
    render(
      <AgentIdentity
        details={agentDetails({
          name: "Acme Redeemer",
          iconUrl: "javascript:alert(1)",
        })}
        agentVault={VAULT}
      />,
    );

    expect(screen.queryByTestId("agent-identity-icon")).toBeNull();
    expect(screen.getByTestId("agent-identity-monogram")).toHaveTextContent(
      "A",
    );
  });

  it("hides the address sub-line when showAddress is false", () => {
    render(
      <AgentIdentity
        details={agentDetails({ name: "Acme Redeemer" })}
        agentVault={VAULT}
        showAddress={false}
      />,
    );

    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      "Acme Redeemer",
    );
    expect(screen.queryByTestId("agent-identity-address")).toBeNull();
  });
});
