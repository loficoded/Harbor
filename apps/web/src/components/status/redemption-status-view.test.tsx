import type { ReactNode } from "react";

import {
  RedemptionStatusView,
  type RedemptionStatusViewProps,
  type StatusFreshness,
  type StatusSubmission,
} from "@/components/status/redemption-status-view";
import { formatAddress } from "@/lib/format";
import { deriveRedemptionStatusViewModel } from "@/lib/redemption-status";
import { agentDetails } from "@/test/agents-fixtures";
import {
  defaultSubmittedResponse,
  makeRedemptionResponse,
  proofReadyResponse,
  recoveredResponse,
  settledResponse,
} from "@/test/redemption-status-fixtures";
import type { GetRedemptionResponse } from "@harbor/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// next/link needs the App Router runtime, absent under jsdom. Render a plain
// anchor instead (mirrors the app-shell test double).
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
    }) => createElement("a", { href, ...rest }, children),
  };
});

const baseFreshness: StatusFreshness = {
  polling: true,
  isFetching: false,
  isStale: false,
  staleReason: null,
  lastUpdatedLabel: "just now",
};

const baseSubmission: StatusSubmission = {
  transactionHash: null,
  relatedRequests: [{ requestId: "4207", isCurrent: true }],
};

function renderView(overrides: Partial<RedemptionStatusViewProps> = {}) {
  const props: RedemptionStatusViewProps = {
    requestId: "4207",
    phase: "ready",
    viewModel: null,
    submission: baseSubmission,
    freshness: baseFreshness,
    errorMessage: null,
    errorRequestId: null,
    ...overrides,
  };
  return render(<RedemptionStatusView {...props} />);
}

function renderReady(
  response: GetRedemptionResponse,
  overrides: Partial<RedemptionStatusViewProps> = {},
) {
  return renderView({
    phase: "ready",
    viewModel: deriveRedemptionStatusViewModel(response),
    ...overrides,
  });
}

describe("RedemptionStatusView — non-ready phases", () => {
  it("renders the empty phase with a console link", () => {
    renderView({ requestId: "", phase: "empty" });
    expect(screen.getByText("No redemption selected")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /redemption console/i }),
    ).toBeInTheDocument();
  });

  it("renders the loading phase", () => {
    renderView({ phase: "loading" });
    expect(screen.getByText("Loading redemption status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the not-found phase and retries", async () => {
    const onRetry = vi.fn();
    renderView({ phase: "not-found", onRetry });

    expect(screen.getByText("Redemption not found")).toBeInTheDocument();
    // The looked-up id is echoed back.
    expect(screen.getAllByText("4207").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the API error phase with message, request id, and retry", async () => {
    const onRetry = vi.fn();
    renderView({
      phase: "error",
      errorMessage: "Internal server error",
      errorRequestId: "req-42",
      onRetry,
    });

    expect(
      screen.getByText("Couldn't load redemption status"),
    ).toBeInTheDocument();
    expect(screen.getByText("Internal server error")).toBeInTheDocument();
    expect(screen.getByText(/req-42/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders a stale-data banner over cached data", () => {
    renderReady(settledResponse(), {
      freshness: {
        ...baseFreshness,
        polling: false,
        isStale: true,
        staleReason: "refetch-failed",
        lastUpdatedLabel: "45s ago",
      },
    });

    expect(screen.getByText("Data may be stale")).toBeInTheDocument();
    expect(
      screen.getByText(/reconnecting to the Harbor API/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last updated 45s ago/)).toBeInTheDocument();
  });
});

describe("RedemptionStatusView — timeline per major status", () => {
  it("REQUESTED shows the request as current", () => {
    renderReady(makeRedemptionResponse({ status: "REQUESTED" }));
    expect(screen.getByText("Redemption requested")).toBeInTheDocument();
    expect(screen.getByText("Agent payment window active")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("WATCHING shows the payment window as current", () => {
    renderReady(makeRedemptionResponse({ status: "WATCHING" }));
    expect(screen.getByText("Agent payment window active")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("SETTLED shows the settlement milestone and receipt", () => {
    renderReady(settledResponse());
    expect(screen.getByText("Settled on XRPL")).toBeInTheDocument();
    expect(screen.getByText("Settlement receipt")).toBeInTheDocument();
    // Terminal success stops polling.
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("WINDOW_EXPIRED shows the missed window", () => {
    renderReady(makeRedemptionResponse({ status: "WINDOW_EXPIRED" }));
    expect(screen.getByText("Payment window missed")).toBeInTheDocument();
    expect(screen.getByText("Default recovery")).toBeInTheDocument();
  });

  it("REQUEST_PROOF shows the FDC request milestone", () => {
    renderReady(
      makeRedemptionResponse({
        status: "REQUEST_PROOF",
        fdcRequestStatus: "SUBMITTED",
      }),
    );
    expect(
      screen.getByText("FDC non-payment proof requested"),
    ).toBeInTheDocument();
    expect(screen.getByText("SUBMITTED")).toBeInTheDocument();
  });

  it("PROOF_READY shows the ready proof and renders the injected self-recovery slot", () => {
    renderReady(proofReadyResponse(), {
      selfRecoverySlot: <div>INJECTED_SELF_RECOVERY</div>,
    });
    expect(screen.getAllByText("Proof ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Default recovery")).toBeInTheDocument();
    // The live self-recovery control (Prompt #20) is injected by the container
    // as a slot so this view stays pure; it renders in the ready phase.
    expect(screen.getByText("INJECTED_SELF_RECOVERY")).toBeInTheDocument();
  });

  it("omits the self-recovery slot when none is injected (e.g. settled)", () => {
    renderReady(settledResponse());
    expect(
      screen.queryByText("INJECTED_SELF_RECOVERY"),
    ).not.toBeInTheDocument();
  });

  it("DEFAULT_SUBMITTED shows the submitted default and its tx link", () => {
    renderReady(defaultSubmittedResponse());
    expect(screen.getAllByText("Default submitted").length).toBeGreaterThan(0);
    expect(screen.getByText("Default tx hash")).toBeInTheDocument();
  });

  it("RECOVERED shows the recovered terminal state", () => {
    renderReady(recoveredResponse());
    expect(screen.getAllByText("Recovered").length).toBeGreaterThan(0);
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("FAILED surfaces an attention banner with the reason", () => {
    renderReady(
      makeRedemptionResponse({
        status: "FAILED",
        statusReason: "Executor reverted the default",
      }),
    );
    expect(screen.getByText(/manual attention needed/i)).toBeInTheDocument();
    expect(
      screen.getByText("Executor reverted the default"),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed — manual attention")).toBeInTheDocument();
  });

  it("UNKNOWN surfaces an attention banner", () => {
    renderReady(makeRedemptionResponse({ status: "UNKNOWN" }));
    expect(
      screen.getByText("Status unknown — manual attention"),
    ).toBeInTheDocument();
  });
});

describe("RedemptionStatusView — settlement receipt fields", () => {
  it("shows every receipt field", () => {
    renderReady(settledResponse());
    expect(screen.getByText("XRPL tx hash")).toBeInTheDocument();
    expect(screen.getByText("Amount delivered")).toBeInTheDocument();
    expect(screen.getByText("10 FXRP")).toBeInTheDocument();
    expect(screen.getByText("Ledger index")).toBeInTheDocument();
    expect(screen.getByText("48213377")).toBeInTheDocument();
    expect(screen.getByText("Agent vault")).toBeInTheDocument();
    expect(screen.getByText("Payment reference")).toBeInTheDocument();
    // Honest copy: observation is for UX, not enforcement.
    expect(
      screen.getByText(/observation is recorded for visibility only/i),
    ).toBeInTheDocument();
  });
});

describe("RedemptionStatusView — default recovery fields", () => {
  it("shows FDC status, proof, default tx, and recovered", () => {
    renderReady(recoveredResponse());
    expect(screen.getByText("FDC request status")).toBeInTheDocument();
    expect(screen.getByText("FDC voting round")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText("Default tx hash")).toBeInTheDocument();
    // Honest copy: FDC + AssetManager enforce recovery.
    expect(
      screen.getByText(/enforced by FDC proofs and the AssetManager/i),
    ).toBeInTheDocument();
  });
});

describe("RedemptionStatusView — related requests", () => {
  it("renders a compact related-requests list with links to siblings", () => {
    renderReady(settledResponse(), {
      submission: {
        ...baseSubmission,
        relatedRequests: [
          { requestId: "4207", isCurrent: true },
          { requestId: "4208", isCurrent: false },
          { requestId: "4209", isCurrent: false },
        ],
      },
    });

    expect(screen.getByText("Related requests")).toBeInTheDocument();
    expect(screen.getByText("Viewing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "4208" })).toHaveAttribute(
      "href",
      "/status/4208",
    );
    expect(screen.getByRole("link", { name: "4209" })).toHaveAttribute(
      "href",
      "/status/4209",
    );
  });

  it("omits the related-requests list when there is only one id", () => {
    renderReady(settledResponse());
    expect(screen.queryByText("Related requests")).toBeNull();
  });
});

describe("RedemptionStatusView — protocol-assigned agent (FIFO)", () => {
  it("shows the indexed agent as protocol-assigned, not user-selected", () => {
    renderReady(settledResponse());
    expect(screen.getByText("Assigned agent")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Selected automatically by the FAssets protocol \(FIFO\)/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/You did not choose it/i)).toBeInTheDocument();
  });

  it("never labels any agent as 'preferred' or offers a selection CTA", () => {
    renderReady(settledResponse());
    expect(screen.queryByText(/preferred agent/i)).toBeNull();
    expect(screen.queryByText(/choose (an |your )?agent/i)).toBeNull();
    expect(screen.queryByText(/select agent/i)).toBeNull();
    expect(screen.queryByText(/redeem with this agent/i)).toBeNull();
  });
});

describe("RedemptionStatusView — submission details and honest copy", () => {
  it("shows preserved submission details (redeem transaction only)", () => {
    renderReady(settledResponse(), {
      submission: {
        transactionHash: `0x${"ab".repeat(32)}`,
        relatedRequests: baseSubmission.relatedRequests,
      },
    });
    expect(screen.getByText("Submission details")).toBeInTheDocument();
    expect(screen.getByText("Redeem transaction")).toBeInTheDocument();
  });

  it("always includes the heuristic-score honest note", () => {
    renderReady(settledResponse());
    expect(
      screen.getByText(/scores shown elsewhere are a heuristic/i),
    ).toBeInTheDocument();
  });
});

describe("RedemptionStatusView — assigned agent official identity", () => {
  it("renders the assigned agent's official name and icon when available", () => {
    renderReady(
      settledResponse({
        agentDetails: agentDetails({
          name: "Acme Redeemer",
          iconUrl: "https://example.com/acme.png",
        }),
      }),
    );

    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      "Acme Redeemer",
    );
    expect(
      screen.getByRole("img", { name: "Acme Redeemer agent icon" }),
    ).toBeInTheDocument();
  });

  it("falls back to the vault address when the agent has no official details", () => {
    const response = settledResponse();
    renderReady(response);

    // The identity label is the truncated vault address, and no icon renders.
    expect(screen.getByTestId("agent-identity-name")).toHaveTextContent(
      formatAddress(response.redemption.agentVault),
    );
    expect(screen.queryByTestId("agent-identity-icon")).toBeNull();
  });
});

describe("RedemptionStatusView — redeem-by-tag submission details", () => {
  it("WITH_TAG shows the redemption type as 'Destination tag' and the required tag", () => {
    renderReady(
      makeRedemptionResponse({
        status: "REQUESTED",
        redemptionKind: "WITH_TAG",
        destinationTag: "777",
      }),
    );
    expect(screen.getByText("Submission details")).toBeInTheDocument();
    expect(screen.getByText("Redemption type")).toBeInTheDocument();
    // The type value for a redeem-by-tag redemption.
    expect(screen.getByText("Destination tag")).toBeInTheDocument();
    expect(screen.getByText("Required destination tag")).toBeInTheDocument();
    expect(screen.getByText("777")).toBeInTheDocument();
  });

  it("WITH_TAG renders the submission card even with no redeem tx hash, omitting the tx row", () => {
    // baseSubmission carries no transaction hash; a WITH_TAG redemption still
    // renders its type + required tag (the tag is a fact the agent must pay
    // with), and simply omits the redeem-transaction row.
    renderReady(
      makeRedemptionResponse({
        status: "REQUESTED",
        redemptionKind: "WITH_TAG",
        destinationTag: "9",
      }),
      {
        submission: {
          transactionHash: null,
          relatedRequests: baseSubmission.relatedRequests,
        },
      },
    );
    expect(screen.getByText("Submission details")).toBeInTheDocument();
    expect(screen.getByText("Destination tag")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("Redeem transaction")).toBeNull();
  });

  it("WITH_TAG with a null tag shows the type but no required-tag row", () => {
    renderReady(
      makeRedemptionResponse({
        status: "REQUESTED",
        redemptionKind: "WITH_TAG",
        destinationTag: null,
      }),
    );
    expect(screen.getByText("Destination tag")).toBeInTheDocument();
    expect(screen.queryByText("Required destination tag")).toBeNull();
  });

  it("STANDARD shows the 'Standard' type and never a required-tag row", () => {
    renderReady(makeRedemptionResponse({ status: "REQUESTED" }), {
      submission: {
        transactionHash: `0x${"ab".repeat(32)}`,
        relatedRequests: baseSubmission.relatedRequests,
      },
    });
    expect(screen.getByText("Submission details")).toBeInTheDocument();
    expect(screen.getByText("Redemption type")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.queryByText("Required destination tag")).toBeNull();
    // The redeem-by-tag type value must not appear for a standard redemption.
    expect(screen.queryByText("Destination tag")).toBeNull();
  });

  it("omits the submission card entirely for a STANDARD redemption with no redeem tx hash", () => {
    // Even though the sidebar renders (assigned agent), SubmissionDetailsCard
    // returns null for STANDARD + no tx hash, so no submission facts show.
    renderReady(makeRedemptionResponse({ status: "REQUESTED" }), {
      submission: {
        transactionHash: null,
        relatedRequests: baseSubmission.relatedRequests,
      },
    });
    expect(screen.queryByText("Submission details")).toBeNull();
    expect(screen.queryByText("Redemption type")).toBeNull();
  });
});

describe("RedemptionStatusView — settlement receipt destination tag", () => {
  it("renders the Destination tag row when the observed payment carried one", () => {
    renderReady(settledResponse({ receiptDestinationTag: "12345" }));
    expect(screen.getByText("Settlement receipt")).toBeInTheDocument();
    expect(screen.getByText("Destination tag")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
  });

  it("renders a Destination tag row for tag 0 (a valid, present tag)", () => {
    // Tag 0 is a real destination tag, not "absent"; the row must render with
    // the literal value 0. Scope the value lookup to the tag row since "0"
    // also appears in other numeric fields (e.g. fees).
    renderReady(settledResponse({ receiptDestinationTag: "0" }));
    const label = screen.getByText("Destination tag");
    const row = label.closest("div");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("0")).toBeInTheDocument();
  });

  it("omits the Destination tag row when the observed payment had none", () => {
    renderReady(settledResponse());
    expect(screen.getByText("Settlement receipt")).toBeInTheDocument();
    expect(screen.queryByText("Destination tag")).toBeNull();
  });
});
