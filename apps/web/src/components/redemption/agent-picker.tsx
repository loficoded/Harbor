"use client";

import {
  AgentPickerView,
  type AgentPickerStatus,
} from "@/components/redemption/agent-picker-view";
import { toAgentOption } from "@/lib/agents";
import type { HarborApiClient } from "@/lib/api-client";
import { useRankedAgents } from "@/lib/use-ranked-agents";
import { useMemo } from "react";

export type AgentPickerProps = {
  /** Selected agent vault, or `null` for no preference. */
  selectedAgent: string | null;
  onSelect: (agentVault: string | null) => void;
  /** Injectable API client (defaults to the env-resolved client). */
  client?: HarborApiClient;
  asset?: string;
};

/**
 * Compact preferred-agent picker for the redemption form (Prompt #17). It reads
 * ranked agents from the shared {@link useRankedAgents} hook — the same source
 * the `/agents` leaderboard uses — and projects each onto the picker's compact
 * option shape. Selection is controlled by the parent form so it can be
 * preserved into the status route after submission. Every load state (loading,
 * error, empty, ready) is rendered by the pure {@link AgentPickerView}.
 */
export function AgentPicker({
  selectedAgent,
  onSelect,
  client,
  asset = "FXRP",
}: AgentPickerProps) {
  const { status, agents, error, reload } = useRankedAgents(
    client === undefined ? { asset } : { asset, client },
  );
  const options = useMemo(() => agents.map(toAgentOption), [agents]);

  return (
    <AgentPickerView
      status={status satisfies AgentPickerStatus}
      agents={options}
      selectedAgent={selectedAgent}
      onSelect={onSelect}
      onRetry={reload}
      errorMessage={error}
    />
  );
}
