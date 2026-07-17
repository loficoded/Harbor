"use client";

import { useMemo, useState } from "react";

import { AgentLeaderboardView } from "@/components/agents/agent-leaderboard-view";
import {
  DEFAULT_AGENT_FILTER,
  DEFAULT_AGENT_SORT,
  rankAgents,
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
 * owns the sort/filter/search UI state, and derives the displayed ordering with
 * the pure {@link rankAgents} helper. All rendering — including loading, error,
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
  const [hideUnavailable, setHideUnavailable] = useState(
    DEFAULT_AGENT_FILTER.hideUnavailable,
  );
  const [query, setQuery] = useState(DEFAULT_AGENT_FILTER.query ?? "");

  const rankedAgents = useMemo(
    () => rankAgents(agents, sortKey, { hideUnavailable, query }),
    [agents, sortKey, hideUnavailable, query],
  );

  return (
    <AgentLeaderboardView
      status={status}
      asset={asset}
      totalCount={agents.length}
      agents={rankedAgents}
      sortKey={sortKey}
      onSortChange={setSortKey}
      hideUnavailable={hideUnavailable}
      onHideUnavailableChange={setHideUnavailable}
      query={query}
      onQueryChange={setQuery}
      onClearFilters={() => {
        setHideUnavailable(false);
        setQuery("");
      }}
      errorMessage={error}
      onRetry={reload}
    />
  );
}
