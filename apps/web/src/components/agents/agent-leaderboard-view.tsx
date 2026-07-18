import { AgentIdentity } from "@/components/agents/agent-identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { inputClasses, selectClasses } from "@/components/ui/control";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  agentAvailabilityLabel,
  agentAvailabilityTone,
  agentSortOptions,
  collateralFieldIndicator,
  collateralSourceLabel,
  formatCollateralRatioBips,
  formatFulfillmentRate,
  formatLots,
  formatScoreBreakdown,
  formatSettlementSeconds,
  isAgentAvailable,
  type AgentSortKey,
  type RankedAgent,
} from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { RankedAgentsStatus } from "@/lib/use-ranked-agents";
import type { ReactElement, ReactNode } from "react";

export type AgentLeaderboardViewProps = {
  status: RankedAgentsStatus;
  asset: string;
  /** Unfiltered agent count from the backend (distinguishes empty vs filtered). */
  totalCount: number;
  /** Agents after sorting and filtering. */
  agents: readonly RankedAgent[];
  sortKey: AgentSortKey;
  onSortChange: (key: AgentSortKey) => void;
  hideUnavailable: boolean;
  onHideUnavailableChange: (value: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onClearFilters: () => void;
  errorMessage?: string | null;
  onRetry?: () => void;
};

/**
 * Pure, prop-driven agent reliability leaderboard. Every load state (loading,
 * error, backend-empty, filtered-empty, ready) renders from props so the
 * container's data handling is unit testable without a live backend. The
 * ranking is presented as a transparent heuristic, and a responsive
 * table/cards pair keeps it scannable from a 400px panel up to desktop. On
 * desktop it reads as a monitoring dashboard: a summary ribbon, a sticky
 * search/sort/filter toolbar, then the ranked table.
 */
export function AgentLeaderboardView({
  status,
  totalCount,
  agents,
  sortKey,
  onSortChange,
  hideUnavailable,
  onHideUnavailableChange,
  query,
  onQueryChange,
  onClearFilters,
  errorMessage,
  onRetry,
}: AgentLeaderboardViewProps): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <InformationalNote />

      {status === "loading" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <Spinner label="Loading agents…" />
        </div>
      ) : status === "error" ? (
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
            {errorMessage ?? "The agent leaderboard is unavailable right now."}
          </p>
        </Callout>
      ) : status === "empty" ? (
        <EmptyState
          title="No ranked agents yet"
          description="The Harbor backend has not scored any agents for this asset yet. Check back once redemptions have been observed."
        />
      ) : (
        <>
          {agents.length > 0 ? (
            <LeaderboardSummary agents={agents} totalCount={totalCount} />
          ) : null}

          <LeaderboardToolbar
            sortKey={sortKey}
            onSortChange={onSortChange}
            hideUnavailable={hideUnavailable}
            onHideUnavailableChange={onHideUnavailableChange}
            query={query}
            onQueryChange={onQueryChange}
            shown={agents.length}
            total={totalCount}
            formulaVersion={agents[0]?.formulaVersion ?? null}
          />

          {agents.length === 0 ? (
            <EmptyState
              title="No agents match the current filter"
              description="No ranked agents match your search and filters. Clear them to see all agents."
            >
              <Button size="sm" variant="secondary" onClick={onClearFilters}>
                Show all agents
              </Button>
            </EmptyState>
          ) : (
            <>
              {/*
               * Region-level description shared by the desktop table and the
               * mobile cards. Rendered once here — outside the responsive
               * table/cards split — so the heuristic framing is present at every
               * viewport. The desktop <table> caption below is `hidden` on
               * mobile (the table is `md:block`), so it cannot be the sole home
               * of this text without disappearing on the mobile cards layout.
               */}
              <p className="sr-only">
                Agent reliability leaderboard, ranked highest score first.
                Scores are a heuristic, not a guarantee.
              </p>
              <LeaderboardTable agents={agents} />
              <LeaderboardCards agents={agents} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Informational note (FIFO + heuristic), condensed into one panel
// ---------------------------------------------------------------------------

function InformationalNote(): ReactElement {
  return (
    <Callout tone="info" title="Informational analytics only">
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
        <p>
          Agent selection for redemptions is handled automatically by the
          FAssets protocol using FIFO. This leaderboard is informational only
          and does not affect assignment — it cannot be used to choose, prefer,
          or target an agent for a redemption.
        </p>
        <p>
          Reliability scores rank agents by observed fulfillment, settlement
          speed, availability, and collateral. They are an analytics signal for
          understanding network behavior, not a guarantee of settlement and not
          a selection mechanism.
        </p>
      </div>
    </Callout>
  );
}

// ---------------------------------------------------------------------------
// Summary ribbon (aggregates the already-loaded data — no new analytics)
// ---------------------------------------------------------------------------

function LeaderboardSummary({
  agents,
  totalCount,
}: {
  agents: readonly RankedAgent[];
  totalCount: number;
}): ReactElement {
  const availableCount = agents.filter(isAgentAvailable).length;
  const topScore = agents.reduce((max, agent) => Math.max(max, agent.score), 0);
  const fastest = agents.reduce<number | null>((min, agent) => {
    const value = agent.averageSettlementSeconds;
    if (value === null) {
      return min;
    }
    return min === null ? value : Math.min(min, value);
  }, null);

  const stats: readonly { label: string; value: ReactNode }[] = [
    { label: "Ranked agents", value: totalCount },
    { label: "Available now", value: availableCount },
    { label: "Top score", value: topScore },
    { label: "Fastest settlement", value: formatSettlementSeconds(fastest) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {stat.label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: search + sort + availability filter (sticky under the app header)
// ---------------------------------------------------------------------------

type LeaderboardToolbarProps = Pick<
  AgentLeaderboardViewProps,
  | "sortKey"
  | "onSortChange"
  | "hideUnavailable"
  | "onHideUnavailableChange"
  | "query"
  | "onQueryChange"
> & {
  shown: number;
  total: number;
  formulaVersion: string | null;
};

function LeaderboardToolbar({
  sortKey,
  onSortChange,
  hideUnavailable,
  onHideUnavailableChange,
  query,
  onQueryChange,
  shown,
  total,
  formulaVersion,
}: LeaderboardToolbarProps): ReactElement {
  return (
    <div className="sticky top-16 z-20 -mx-4 flex flex-col gap-3 border-b border-gray-200 bg-gray-50/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4 dark:border-gray-800 dark:bg-gray-950/90 sm:dark:bg-gray-900/70">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="lg:max-w-xs lg:flex-1">
          <label htmlFor="agent-search" className="sr-only">
            Search agents
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="agent-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by name or vault address"
              aria-label="Search agents"
              className={inputClasses("pl-9")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <label
              htmlFor="agent-sort"
              className="shrink-0 text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Sort by
            </label>
            <select
              id="agent-sort"
              aria-label="Sort by"
              value={sortKey}
              onChange={(event) =>
                onSortChange(event.target.value as AgentSortKey)
              }
              className={selectClasses("sm:w-56")}
            >
              {agentSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={hideUnavailable}
              onChange={(event) =>
                onHideUnavailableChange(event.target.checked)
              }
              className="h-4 w-4 rounded border-gray-300 text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700"
            />
            Hide unavailable agents
          </label>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Showing {shown} of {total} ranked {total === 1 ? "agent" : "agents"}
        {formulaVersion !== null ? ` · formula ${formulaVersion}` : ""}
      </p>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path
        d="m20 20-3.2-3.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared cells
// ---------------------------------------------------------------------------

/** Small horizontal bar visualizing the 0–100 heuristic score. */
function ScoreBar({ score }: { score: number }): ReactElement {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div
      className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Collapsible score total plus its component explanation. */
function ScoreDetails({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <details className="min-w-[3.5rem]">
      <summary className="cursor-pointer list-inside text-sm font-semibold tabular-nums text-gray-900 marker:text-gray-400 dark:text-gray-100">
        {agent.score}
        <span className="ml-1 text-xs font-normal text-gray-400">
          breakdown
        </span>
      </summary>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {formatScoreBreakdown(agent)}
      </p>
    </details>
  );
}

function ScoreCell({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <ScoreDetails agent={agent} />
      <ScoreBar score={agent.score} />
    </div>
  );
}

function FulfillmentValue({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span className="tabular-nums">
        {formatFulfillmentRate(agent.fulfillmentRate)}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {agent.successfulRedemptions}/{agent.totalTerminalRedemptions} settled
      </span>
    </div>
  );
}

function DefaultsValue({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span className="tabular-nums">{agent.defaultedRedemptions}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        of {agent.totalTerminalRedemptions} terminal
      </span>
    </div>
  );
}

function CollateralValue({ agent }: { agent: RankedAgent }): ReactElement {
  const indicator = collateralFieldIndicator(agent);

  return (
    <div className="flex flex-col gap-1 leading-tight">
      <span className="tabular-nums">
        {formatCollateralRatioBips(agent.collateralRatioBips)}
      </span>
      <span className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {collateralSourceLabel(agent.collateralRatioSource)}
        {indicator ? (
          <span title={indicator.title}>
            <Badge tone={indicator.tone}>{indicator.label}</Badge>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function AvailabilityBadge({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <Badge tone={agentAvailabilityTone(agent.availability)}>
      {agentAvailabilityLabel(agent.availability)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Desktop table
// ---------------------------------------------------------------------------

const HEAD_CELL =
  "px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400";
const HEAD_CELL_NUM = `${HEAD_CELL} text-right`;
const BODY_CELL = "px-4 py-3 align-middle text-gray-900 dark:text-gray-100";
const BODY_CELL_NUM = `${BODY_CELL} text-right tabular-nums`;

function LeaderboardTable({
  agents,
}: {
  agents: readonly RankedAgent[];
}): ReactElement {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block dark:border-gray-800 dark:bg-gray-900">
      <div className="overflow-x-auto">
        <table
          aria-label="Agent reliability leaderboard"
          className="w-full border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60">
              <th scope="col" className={HEAD_CELL_NUM}>
                #
              </th>
              <th scope="col" className={HEAD_CELL}>
                Agent
              </th>
              <th scope="col" className={HEAD_CELL}>
                Score
              </th>
              <th scope="col" className={HEAD_CELL}>
                Fulfillment
              </th>
              <th scope="col" className={HEAD_CELL}>
                Defaults
              </th>
              <th scope="col" className={HEAD_CELL_NUM}>
                Avg settlement
              </th>
              <th scope="col" className={HEAD_CELL}>
                Availability
              </th>
              <th scope="col" className={HEAD_CELL_NUM}>
                Free lots
              </th>
              <th scope="col" className={HEAD_CELL}>
                Collateral
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, index) => (
              <tr
                key={agent.agentVault}
                data-testid="agent-row"
                className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
              >
                <td className={`${BODY_CELL_NUM} font-medium text-gray-400`}>
                  {index + 1}
                </td>
                <th scope="row" className={`${BODY_CELL} font-normal`}>
                  <AgentIdentity
                    details={agent.details}
                    agentVault={agent.agentVault}
                    size="sm"
                  />
                </th>
                <td className={BODY_CELL}>
                  <ScoreCell agent={agent} />
                </td>
                <td className={BODY_CELL}>
                  <FulfillmentValue agent={agent} />
                </td>
                <td className={BODY_CELL}>
                  <DefaultsValue agent={agent} />
                </td>
                <td className={BODY_CELL_NUM}>
                  {formatSettlementSeconds(agent.averageSettlementSeconds)}
                </td>
                <td className={BODY_CELL}>
                  <AvailabilityBadge agent={agent} />
                </td>
                <td className={BODY_CELL_NUM}>
                  {formatLots(agent.availableLots)}
                </td>
                <td className={BODY_CELL}>
                  <CollateralValue agent={agent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile cards
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

function LeaderboardCards({
  agents,
}: {
  agents: readonly RankedAgent[];
}): ReactElement {
  return (
    <ul
      aria-label="Agent reliability leaderboard"
      className="flex flex-col gap-3 md:hidden"
    >
      {agents.map((agent, index) => (
        <li
          key={agent.agentVault}
          data-testid="agent-card"
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-gray-100 px-1.5 text-xs font-semibold tabular-nums text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {index + 1}
              </span>
              <AgentIdentity
                details={agent.details}
                agentVault={agent.agentVault}
                size="sm"
              />
            </div>
            <ScoreCell agent={agent} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 text-sm dark:border-gray-800/60">
            <Field label="Fulfillment">
              <FulfillmentValue agent={agent} />
            </Field>
            <Field label="Defaults">
              <DefaultsValue agent={agent} />
            </Field>
            <Field label="Avg settlement">
              {formatSettlementSeconds(agent.averageSettlementSeconds)}
            </Field>
            <Field label="Availability">
              <AvailabilityBadge agent={agent} />
            </Field>
            <Field label="Free lots">{formatLots(agent.availableLots)}</Field>
            <Field label="Collateral">
              <CollateralValue agent={agent} />
            </Field>
          </dl>
        </li>
      ))}
    </ul>
  );
}
