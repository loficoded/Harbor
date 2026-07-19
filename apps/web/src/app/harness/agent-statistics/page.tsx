"use client";

import { AgentLeaderboardView } from "@/components/agents/agent-leaderboard-view";
import { PageHeader } from "@/components/ui";
import {
  DEFAULT_AGENT_FILTER,
  DEFAULT_AGENT_SORT,
  rankAgents,
  type AgentSortKey,
} from "@/lib/agents";
import { useMemo, useState } from "react";

import { HARNESS_AGENTS } from "@/app/harness/harness-data";

export default function HarnessAgentStatisticsPage() {
  const allAgents = HARNESS_AGENTS;
  const [sortKey, setSortKey] = useState<AgentSortKey>(DEFAULT_AGENT_SORT);
  const [hideUnavailable, setHideUnavailable] = useState(
    DEFAULT_AGENT_FILTER.hideUnavailable,
  );
  const [query, setQuery] = useState(DEFAULT_AGENT_FILTER.query ?? "");

  const rankedAgents = useMemo(
    () => rankAgents(allAgents, sortKey, { hideUnavailable, query }),
    [allAgents, sortKey, hideUnavailable, query],
  );

  return (
    <div>
      <PageHeader
        eyebrow="FXRP · Coston2"
        title="Agent statistics"
        description="Observed agent reliability analytics for FXRP on Coston2 — settlement history, availability, collateral, and heuristic scores. Informational only; it does not affect redemption assignment."
      />
      <AgentLeaderboardView
        status="ready"
        asset="FXRP"
        totalCount={allAgents.length}
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
      />
    </div>
  );
}
