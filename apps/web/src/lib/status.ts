import type { RedemptionStatus } from "@harbor/shared";

/**
 * Visual tone assigned to a status badge. Kept deliberately small and semantic
 * so the palette stays quiet: most lifecycle states are neutral/progress, and
 * strong colors are reserved for terminal success and failure.
 */
export type StatusTone =
  "neutral" | "info" | "progress" | "success" | "warning" | "danger";

/** Human-readable label for each redemption status. */
export const redemptionStatusLabels: Record<RedemptionStatus, string> = {
  REQUESTED: "Requested",
  WATCHING: "Watching",
  SETTLED: "Settled",
  WINDOW_EXPIRED: "Window expired",
  REQUEST_PROOF: "Requesting proof",
  PROOF_READY: "Proof ready",
  DEFAULT_SUBMITTED: "Default submitted",
  RECOVERED: "Recovered",
  FAILED: "Failed",
  UNKNOWN: "Unknown",
};

/** Badge tone for each redemption status. */
export const redemptionStatusTones: Record<RedemptionStatus, StatusTone> = {
  REQUESTED: "info",
  WATCHING: "progress",
  SETTLED: "success",
  WINDOW_EXPIRED: "warning",
  REQUEST_PROOF: "progress",
  PROOF_READY: "progress",
  DEFAULT_SUBMITTED: "progress",
  RECOVERED: "success",
  FAILED: "danger",
  UNKNOWN: "neutral",
};

export function redemptionStatusLabel(status: RedemptionStatus): string {
  return redemptionStatusLabels[status];
}

export function redemptionStatusTone(status: RedemptionStatus): StatusTone {
  return redemptionStatusTones[status];
}
