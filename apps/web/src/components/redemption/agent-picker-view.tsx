import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Spinner } from "@/components/ui/spinner";
import { formatAddress } from "@/lib/format";
import type { ReactElement } from "react";

/** Load state of the compact agent picker. */
export type AgentPickerStatus = "loading" | "error" | "empty" | "ready";

/** Minimal agent projection the picker renders (from `GET /agents`). */
export type AgentOption = Readonly<{
  agentVault: string;
  score: number;
  /** Available lots as a JSON-safe string (serialized bigint on the wire). */
  availableLots: string;
  availability: string;
}>;

/** Sentinel select value meaning "let the network assign an agent". */
export const NO_AGENT_PREFERENCE = "";

export type AgentPickerViewProps = {
  status: AgentPickerStatus;
  agents: readonly AgentOption[];
  /** Selected agent vault, or `null` for no preference. */
  selectedAgent: string | null;
  onSelect: (agentVault: string | null) => void;
  onRetry?: () => void;
  errorMessage?: string | null;
};

function availabilityLabel(availability: string): string {
  switch (availability) {
    case "AVAILABLE":
      return "Available";
    case "UNAVAILABLE":
      return "Unavailable";
    default:
      return "Unknown";
  }
}

function optionLabel(agent: AgentOption): string {
  return `${formatAddress(agent.agentVault)} · score ${agent.score} · ${agent.availableLots} lots`;
}

/**
 * Compact, prop-driven agent picker. Not the full leaderboard: it surfaces just
 * enough reliability signal to pick a preferred agent, and always offers a
 * "no preference" default so redemption is never blocked by backend
 * availability. Every load state (loading, error, empty, ready) is rendered
 * from props so the container's data handling is unit testable.
 */
export function AgentPickerView({
  status,
  agents,
  selectedAgent,
  onSelect,
  onRetry,
  errorMessage,
}: AgentPickerViewProps): ReactElement {
  if (status === "loading") {
    return <Spinner label="Loading agents…" />;
  }

  if (status === "error") {
    return (
      <Callout
        tone="danger"
        title="Could not load agents"
        actions={
          onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        <p>
          {errorMessage ??
            "The agent list is unavailable. You can still redeem without a preferred agent."}
        </p>
      </Callout>
    );
  }

  const selectValue = selectedAgent ?? NO_AGENT_PREFERENCE;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="preferred-agent"
        className="text-xs font-medium text-gray-600 dark:text-gray-400"
      >
        Preferred agent
      </label>
      <select
        id="preferred-agent"
        aria-label="Preferred agent"
        value={selectValue}
        onChange={(event) =>
          onSelect(
            event.target.value === NO_AGENT_PREFERENCE
              ? null
              : event.target.value,
          )
        }
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      >
        <option value={NO_AGENT_PREFERENCE}>No preference (network-assigned)</option>
        {agents.map((agent) => (
          <option key={agent.agentVault} value={agent.agentVault}>
            {optionLabel(agent)}
          </option>
        ))}
      </select>

      {status === "empty" ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No ranked agents are available yet. Redemption will use the
          network-assigned agent queue.
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Scores are heuristic. The AssetManager fills redemptions from its agent
          queue, so a preference is advisory and preserved for status tracking.
        </p>
      )}

      {selectedAgent !== null ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Preferred:{" "}
          <span className="font-mono">{formatAddress(selectedAgent)}</span>
          {agents.some(
            (agent) =>
              agent.agentVault === selectedAgent &&
              agent.availability !== "AVAILABLE",
          )
            ? ` (${availabilityLabel(
                agents.find((agent) => agent.agentVault === selectedAgent)
                  ?.availability ?? "UNKNOWN",
              )})`
            : null}
        </p>
      ) : null}
    </div>
  );
}
