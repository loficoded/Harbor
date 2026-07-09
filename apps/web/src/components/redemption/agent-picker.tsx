"use client";

import {
  AgentPickerView,
  type AgentOption,
  type AgentPickerStatus,
} from "@/components/redemption/agent-picker-view";
import {
  createHarborApiClient,
  type HarborApiClient,
} from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AgentPickerProps = {
  /** Selected agent vault, or `null` for no preference. */
  selectedAgent: string | null;
  onSelect: (agentVault: string | null) => void;
  /** Injectable API client (defaults to the env-resolved client). */
  client?: HarborApiClient;
  asset?: string;
};

type PickerState = Readonly<{
  status: AgentPickerStatus;
  agents: readonly AgentOption[];
  error: string | null;
}>;

const INITIAL_STATE: PickerState = {
  status: "loading",
  agents: [],
  error: null,
};

/**
 * Loads ranked agents from the Harbor backend (`GET /agents`) and renders the
 * compact picker. Handles the loading, empty, error, and ready states
 * explicitly; the API client is injectable so those states are unit testable
 * without a live backend. Selection is controlled by the parent form so it can
 * be preserved into the status route after submission.
 */
export function AgentPicker({
  selectedAgent,
  onSelect,
  client,
  asset = "FXRP",
}: AgentPickerProps) {
  const apiClient = useMemo(
    () => client ?? createHarborApiClient(),
    [client],
  );
  const [state, setState] = useState<PickerState>(INITIAL_STATE);
  const activeController = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setState(INITIAL_STATE);

    apiClient
      .getAgents(asset, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        const agents: AgentOption[] = response.agents.map((agent) => ({
          agentVault: agent.agentVault,
          score: agent.score,
          availableLots: agent.availableLots,
          availability: agent.availability,
        }));
        setState({
          status: agents.length === 0 ? "empty" : "ready",
          agents,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          agents: [],
          error: error instanceof Error ? error.message : "Failed to load agents",
        });
      });
  }, [apiClient, asset]);

  useEffect(() => {
    load();
    return () => activeController.current?.abort();
  }, [load]);

  return (
    <AgentPickerView
      status={state.status}
      agents={state.agents}
      selectedAgent={selectedAgent}
      onSelect={onSelect}
      onRetry={load}
      errorMessage={state.error}
    />
  );
}
