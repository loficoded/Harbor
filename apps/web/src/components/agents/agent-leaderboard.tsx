"use client";

import { useMemo, useState } from "react";

import { AgentLeaderboardView } from "@/components/agents/agent-leaderboard-view";
import {
  DEFAULT_AGENT_FILTER,
  DEFAULT_AGENT_SORT,
  rankAgents,
  type AgentFilter,
  type AgentSortKey,
} from "@/lib/agents";
import type { HarborApiClient } from "@/lib/api-client";
import { useRankedAgents } from "@/lib/use-ranked-agents";

export type AgentLeaderboardProps = {
  /** Injectable API client (defaults to the env-resolved client). */
  client?: HarborApiClient;
  asset?: string;
};

/**
 * Agent leaderboard container. Loads ranked agents from the shared
 * {@link useRankedAgents} hook (the same source the home-page picker uses),
 * owns the sort/filter UI state, and derives the displayed ordering with the
 * pure {@link rankAgents} helper. All rendering — including loading, error,
 * empty, and filtered-empty states — lives in {@link AgentLeaderboardView}.
 */
export function AgentLeaderboard({
  client,
  asset = "FXRP",
}: AgentLeaderboardProps) {
  const { status, agents, error, reload } = useRankedAgents(
    client === undefined ? { asset } : { asset, client },
  );
  const [sortKey, setSortKey] = useState<AgentSortKey>(DEFAULT_AGENT_SORT);
  const [filter, setFilter] = useState<AgentFilter>(DEFAULT_AGENT_FILTER);

  const rankedAgents = useMemo(
    () => rankAgents(agents, sortKey, filter),
    [agents, sortKey, filter],
  );

  return (
    <AgentLeaderboardView
      status={status}
      asset={asset}
      totalCount={agents.length}
      agents={rankedAgents}
      sortKey={sortKey}
      onSortChange={setSortKey}
      hideUnavailable={filter.hideUnavailable}
      onHideUnavailableChange={(hideUnavailable) =>
        setFilter({ hideUnavailable })
      }
      errorMessage={error}
      onRetry={reload}
    />
  );
}
