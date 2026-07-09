import {
  buildRelatedRequests,
  deriveDefaultRecovery,
  deriveRedemptionStatusViewModel,
  deriveSelfRecoveryPlaceholder,
  deriveSettlementReceipt,
  deriveStatusTimeline,
  formatUbaAmount,
  isRedemptionResponse,
  isTerminalStatus,
  isTerminalSuccess,
  needsAttention,
  parseAdditionalRequestIds,
  type TimelineStep,
  type TimelineStepState,
} from "@/lib/redemption-status";
import {
  defaultSubmittedResponse,
  makeRedemptionResponse,
  proofReadyResponse,
  recoveredResponse,
  settledResponse,
} from "@/test/redemption-status-fixtures";
import type { RedemptionStatus } from "@harbor/shared";
import { describe, expect, it } from "vitest";

function stateOf(
  steps: readonly TimelineStep[],
  status: RedemptionStatus,
): TimelineStepState | undefined {
  return steps.find((step) => step.status === status)?.state;
}

describe("isTerminalStatus / isTerminalSuccess / needsAttention", () => {
  it("classifies terminal states", () => {
    expect(isTerminalStatus("SETTLED")).toBe(true);
    expect(isTerminalStatus("RECOVERED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("WATCHING")).toBe(false);
    expect(isTerminalStatus("PROOF_READY")).toBe(false);
  });

  it("distinguishes terminal success from failure", () => {
    expect(isTerminalSuccess("SETTLED")).toBe(true);
    expect(isTerminalSuccess("RECOVERED")).toBe(true);
    expect(isTerminalSuccess("FAILED")).toBe(false);
  });

  it("flags failed and unknown as needing attention", () => {
    expect(needsAttention("FAILED")).toBe(true);
    expect(needsAttention("UNKNOWN")).toBe(true);
    expect(needsAttention("WATCHING")).toBe(false);
  });
});

describe("deriveStatusTimeline — major statuses", () => {
  it("REQUESTED: requested current, everything else upcoming", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({ status: "REQUESTED" }),
    );
    expect(stateOf(steps, "REQUESTED")).toBe("current");
    expect(stateOf(steps, "WATCHING")).toBe("upcoming");
    expect(stateOf(steps, "SETTLED")).toBe("upcoming");
    expect(stateOf(steps, "WINDOW_EXPIRED")).toBe("upcoming");
    expect(stateOf(steps, "RECOVERED")).toBe("upcoming");
  });

  it("WATCHING: requested complete, watching current", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({ status: "WATCHING" }),
    );
    expect(stateOf(steps, "REQUESTED")).toBe("complete");
    expect(stateOf(steps, "WATCHING")).toBe("current");
    expect(stateOf(steps, "SETTLED")).toBe("upcoming");
  });

  it("SETTLED: watching implied complete, settled complete, recovery skipped", () => {
    const steps = deriveStatusTimeline(settledResponse());
    expect(stateOf(steps, "REQUESTED")).toBe("complete");
    // SETTLED is reachable only from WATCHING, so WATCHING is implied complete.
    expect(stateOf(steps, "WATCHING")).toBe("complete");
    expect(stateOf(steps, "SETTLED")).toBe("complete");
    expect(stateOf(steps, "WINDOW_EXPIRED")).toBe("skipped");
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("skipped");
    expect(stateOf(steps, "RECOVERED")).toBe("skipped");
    const settled = steps.find((step) => step.status === "SETTLED");
    expect(settled?.occurredAt).not.toBeNull();
  });

  it("WINDOW_EXPIRED: settled skipped, window current, later recovery upcoming", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({ status: "WINDOW_EXPIRED" }),
    );
    expect(stateOf(steps, "SETTLED")).toBe("skipped");
    expect(stateOf(steps, "WINDOW_EXPIRED")).toBe("current");
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("upcoming");
    expect(stateOf(steps, "PROOF_READY")).toBe("upcoming");
    expect(stateOf(steps, "RECOVERED")).toBe("upcoming");
  });

  it("REQUEST_PROOF: proof request current, settled skipped", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({
        status: "REQUEST_PROOF",
        fdcRequestStatus: "SUBMITTED",
      }),
    );
    expect(stateOf(steps, "SETTLED")).toBe("skipped");
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("current");
    expect(stateOf(steps, "PROOF_READY")).toBe("upcoming");
    // Earlier recovery milestone with no evidence is not claimed as complete.
    expect(stateOf(steps, "WINDOW_EXPIRED")).toBe("skipped");
  });

  it("PROOF_READY: request implied complete, proof current", () => {
    const steps = deriveStatusTimeline(proofReadyResponse());
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("complete");
    expect(stateOf(steps, "PROOF_READY")).toBe("current");
    expect(stateOf(steps, "DEFAULT_SUBMITTED")).toBe("upcoming");
    expect(stateOf(steps, "RECOVERED")).toBe("upcoming");
    expect(stateOf(steps, "SETTLED")).toBe("skipped");
  });

  it("DEFAULT_SUBMITTED: proof chain complete, default current", () => {
    const steps = deriveStatusTimeline(defaultSubmittedResponse());
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("complete");
    expect(stateOf(steps, "PROOF_READY")).toBe("complete");
    expect(stateOf(steps, "DEFAULT_SUBMITTED")).toBe("current");
    expect(stateOf(steps, "RECOVERED")).toBe("upcoming");
  });

  it("RECOVERED: recovery chain complete, recovered complete", () => {
    const steps = deriveStatusTimeline(recoveredResponse());
    expect(stateOf(steps, "REQUEST_PROOF")).toBe("complete");
    expect(stateOf(steps, "PROOF_READY")).toBe("complete");
    expect(stateOf(steps, "DEFAULT_SUBMITTED")).toBe("complete");
    expect(stateOf(steps, "RECOVERED")).toBe("complete");
    expect(stateOf(steps, "SETTLED")).toBe("skipped");
  });

  it("FAILED: appends an attention step and skips unreached steps", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({
        status: "FAILED",
        statusReason: "Executor reverted",
      }),
    );
    const last = steps[steps.length - 1];
    expect(last?.status).toBe("FAILED");
    expect(last?.state).toBe("attention");
    expect(last?.detail).toBe("Executor reverted");
    expect(stateOf(steps, "REQUESTED")).toBe("complete");
    expect(stateOf(steps, "SETTLED")).toBe("skipped");
  });

  it("UNKNOWN: appends an attention step", () => {
    const steps = deriveStatusTimeline(
      makeRedemptionResponse({ status: "UNKNOWN" }),
    );
    const last = steps[steps.length - 1];
    expect(last?.status).toBe("UNKNOWN");
    expect(last?.state).toBe("attention");
  });

  it("preserves evidence timestamps and details on recorded milestones", () => {
    const steps = deriveStatusTimeline(recoveredResponse());
    const proof = steps.find((step) => step.status === "PROOF_READY");
    expect(proof?.occurredAt).not.toBeNull();
    expect(proof?.detail).toContain("FDC round");
  });
});

describe("deriveSettlementReceipt", () => {
  it("returns null when there is no XRPL observation", () => {
    expect(
      deriveSettlementReceipt(makeRedemptionResponse({ status: "WATCHING" })),
    ).toBeNull();
  });

  it("projects the primary receipt and formats the delivered amount", () => {
    const receipt = deriveSettlementReceipt(settledResponse());
    expect(receipt).not.toBeNull();
    expect(receipt?.deliveredAmountUBA).toBe("10000000");
    expect(receipt?.deliveredAmountLabel).toBe("10 FXRP");
    expect(receipt?.ledgerIndex).toBe("48213377");
    expect(receipt?.agentVault).toBe(
      "0x00000000000000000000000000000000000000a1",
    );
    expect(receipt?.observationCount).toBe(1);
  });

  it("counts multiple observations", () => {
    const receipt = deriveSettlementReceipt(
      settledResponse({ settlementCount: 3 }),
    );
    expect(receipt?.observationCount).toBe(3);
  });
});

describe("formatUbaAmount", () => {
  it("formats a valid UBA amount with the FXRP label", () => {
    expect(formatUbaAmount("10000000")).toBe("10 FXRP");
    expect(formatUbaAmount("0")).toBe("0 FXRP");
  });

  it("degrades gracefully on a malformed amount", () => {
    expect(formatUbaAmount("not-a-number")).toBe("not-a-number UBA");
  });
});

describe("deriveDefaultRecovery", () => {
  it("returns null on the happy settlement path", () => {
    expect(deriveDefaultRecovery(settledResponse())).toBeNull();
    expect(
      deriveDefaultRecovery(makeRedemptionResponse({ status: "WATCHING" })),
    ).toBeNull();
  });

  it("summarizes an in-progress recovery with a ready proof", () => {
    const recovery = deriveDefaultRecovery(proofReadyResponse());
    expect(recovery).not.toBeNull();
    expect(recovery?.fdcRequestStatus).toBe("PROOF_READY");
    expect(recovery?.proofReady).toBe(true);
    expect(recovery?.proofCount).toBe(1);
    expect(recovery?.votingRoundId).toBe("12345");
    expect(recovery?.defaultTransactionHash).toBeNull();
    expect(recovery?.recovered).toBe(false);
  });

  it("surfaces the default transaction hash and recovered flag", () => {
    const submitted = deriveDefaultRecovery(defaultSubmittedResponse());
    expect(submitted?.defaultTransactionHash).toBe(`0x${"de".repeat(32)}`);
    expect(submitted?.recovered).toBe(false);

    const recovered = deriveDefaultRecovery(recoveredResponse());
    expect(recovered?.recovered).toBe(true);
  });
});

describe("deriveSelfRecoveryPlaceholder (reserved for Prompt #20)", () => {
  it("is hidden off the recovery track", () => {
    expect(deriveSelfRecoveryPlaceholder(settledResponse()).visible).toBe(
      false,
    );
    expect(
      deriveSelfRecoveryPlaceholder(
        makeRedemptionResponse({ status: "WATCHING" }),
      ).visible,
    ).toBe(false);
  });

  it("is visible but not actionable before the proof is ready", () => {
    const placeholder = deriveSelfRecoveryPlaceholder(
      makeRedemptionResponse({ status: "WINDOW_EXPIRED" }),
    );
    expect(placeholder.visible).toBe(true);
    expect(placeholder.actionable).toBe(false);
  });

  it("is actionable once the proof is ready", () => {
    const placeholder = deriveSelfRecoveryPlaceholder(proofReadyResponse());
    expect(placeholder.visible).toBe(true);
    expect(placeholder.actionable).toBe(true);
  });

  it("stays visible while a default is submitted but not recovered", () => {
    expect(
      deriveSelfRecoveryPlaceholder(defaultSubmittedResponse()).visible,
    ).toBe(true);
  });

  it("is hidden once recovered", () => {
    expect(deriveSelfRecoveryPlaceholder(recoveredResponse()).visible).toBe(
      false,
    );
  });
});

describe("buildRelatedRequests / parseAdditionalRequestIds", () => {
  it("parses the comma-separated more param, trimming and dropping blanks", () => {
    expect(parseAdditionalRequestIds("4208, 4209 ,,")).toEqual([
      "4208",
      "4209",
    ]);
    expect(parseAdditionalRequestIds(undefined)).toEqual([]);
  });

  it("puts the current id first and de-duplicates siblings", () => {
    const related = buildRelatedRequests("4207", ["4208", "4207", "4209", ""]);
    expect(related).toEqual([
      { requestId: "4207", isCurrent: true },
      { requestId: "4208", isCurrent: false },
      { requestId: "4209", isCurrent: false },
    ]);
  });

  it("returns a single entry when there are no siblings", () => {
    expect(buildRelatedRequests("4207", [])).toEqual([
      { requestId: "4207", isCurrent: true },
    ]);
  });
});

describe("isRedemptionResponse", () => {
  it("accepts a well-formed response", () => {
    expect(isRedemptionResponse(settledResponse())).toBe(true);
  });

  it("rejects malformed or unrelated payloads", () => {
    expect(isRedemptionResponse(null)).toBe(false);
    expect(isRedemptionResponse({})).toBe(false);
    expect(isRedemptionResponse({ redemption: {} })).toBe(false);
    // A different endpoint's payload (e.g. the agents list) is rejected.
    expect(isRedemptionResponse({ asset: "FXRP", agents: [] })).toBe(false);
  });
});

describe("deriveRedemptionStatusViewModel", () => {
  it("composes the full model for a recovered redemption", () => {
    const model = deriveRedemptionStatusViewModel(recoveredResponse());
    expect(model.status).toBe("RECOVERED");
    expect(model.statusLabel).toBe("Recovered");
    expect(model.isTerminal).toBe(true);
    expect(model.isTerminalSuccess).toBe(true);
    expect(model.settlement).toBeNull();
    expect(model.recovery?.recovered).toBe(true);
    expect(model.selfRecovery.visible).toBe(false);
    expect(model.timeline.length).toBeGreaterThan(0);
  });

  it("composes the full model for a settled redemption", () => {
    const model = deriveRedemptionStatusViewModel(settledResponse());
    expect(model.status).toBe("SETTLED");
    expect(model.settlement?.deliveredAmountLabel).toBe("10 FXRP");
    expect(model.recovery).toBeNull();
    expect(model.needsAttention).toBe(false);
  });
});
