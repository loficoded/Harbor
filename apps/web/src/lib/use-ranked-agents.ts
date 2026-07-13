"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RankedAgent } from "@/lib/agents";
import { createHarborApiClient, type HarborApiClient } from "@/lib/api-client";

/** Load state of the shared ranked-agents request. */
export type RankedAgentsStatus = "loading" | "error" | "empty" | "ready";

export type UseRankedAgentsOptions = Readonly<{
  asset?: string;
  /** Injectable API client (defaults to the env-resolved client). */
  client?: HarborApiClient;
}>;

export type RankedAgentsResult = Readonly<{
  status: RankedAgentsStatus;
  agents: readonly RankedAgent[];
  error: string | null;
  /** Re-run the request (used by the error-state retry action). */
  reload: () => void;
}>;

type State = Readonly<{
  status: RankedAgentsStatus;
  agents: readonly RankedAgent[];
  error: string | null;
}>;

const INITIAL_STATE: State = { status: "loading", agents: [], error: null };

/**
 * Single source of truth for ranked agent reliability data (`GET /agents`).
 *
 * Consumed by the `/agents` statistics page to render the informational
 * leaderboard from one fetch path and one projection ({@link RankedAgent}).
 * This data is analytics only — it never feeds an agent-selection control,
 * because the FAssets protocol assigns redemption agents automatically (FIFO).
 *
 * The manual `AbortController` fetch — rather than a cache library — keeps the
 * hook injectable and unit-testable with a stand-in client, without requiring
 * extra React providers.
 */
export function useRankedAgents(
  options: UseRankedAgentsOptions = {},
): RankedAgentsResult {
  const { asset = "FXRP", client } = options;
  const apiClient = useMemo(() => client ?? createHarborApiClient(), [client]);
  const [state, setState] = useState<State>(INITIAL_STATE);
  const activeController = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
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
        const agents = response.agents;
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
          error:
            error instanceof Error ? error.message : "Failed to load agents",
        });
      });
  }, [apiClient, asset]);

  useEffect(() => {
    reload();
    return () => activeController.current?.abort();
  }, [reload]);

  return {
    status: state.status,
    agents: state.agents,
    error: state.error,
    reload,
  };
}
