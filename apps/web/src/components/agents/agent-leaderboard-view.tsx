import { AgentIdentity } from "@/components/agents/agent-identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
  type AgentSortKey,
  type RankedAgent,
} from "@/lib/agents";
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
  errorMessage?: string | null;
  onRetry?: () => void;
};

/**
 * Pure, prop-driven agent reliability leaderboard. Every load state (loading,
 * error, backend-empty, filtered-empty, ready) renders from props so the
 * container's data handling is unit testable without a live backend. The
 * ranking is presented as a transparent heuristic, and a responsive
 * table/cards pair keeps it scannable from a 400px panel up to desktop.
 */
export function AgentLeaderboardView({
  status,
  totalCount,
  agents,
  sortKey,
  onSortChange,
  hideUnavailable,
  onHideUnavailableChange,
  errorMessage,
  onRetry,
}: AgentLeaderboardViewProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Callout
        tone="info"
        title="Informational only — the protocol assigns agents (FIFO)"
      >
        <p>
          Agent selection for redemptions is handled automatically by the
          FAssets protocol using FIFO. This leaderboard is informational only
          and does not affect assignment — it cannot be used to choose, prefer,
          or target an agent for a redemption.
        </p>
      </Callout>

      <Callout tone="info" title="Scores are a heuristic">
        <p>
          Reliability scores rank agents by observed fulfillment, settlement
          speed, availability, and collateral. They are an analytics signal for
          understanding network behavior, not a guarantee of settlement and not
          a selection mechanism.
        </p>
      </Callout>

      {status === "loading" ? (
        <Spinner label="Loading agents…" />
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
          <LeaderboardControls
            sortKey={sortKey}
            onSortChange={onSortChange}
            hideUnavailable={hideUnavailable}
            onHideUnavailableChange={onHideUnavailableChange}
          />

          {agents.length === 0 ? (
            <EmptyState
              title="No agents match the current filter"
              description="No ranked agents are currently available. Clear the filter to see all agents."
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onHideUnavailableChange(false)}
              >
                Show all agents
              </Button>
            </EmptyState>
          ) : (
            <>
              <ResultsSummary
                shown={agents.length}
                total={totalCount}
                formulaVersion={agents[0]?.formulaVersion ?? null}
              />
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
// Controls
// ---------------------------------------------------------------------------

type LeaderboardControlsProps = Pick<
  AgentLeaderboardViewProps,
  "sortKey" | "onSortChange" | "hideUnavailable" | "onHideUnavailableChange"
>;

function LeaderboardControls({
  sortKey,
  onSortChange,
  hideUnavailable,
  onHideUnavailableChange,
}: LeaderboardControlsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="agent-sort"
          className="text-xs font-medium text-gray-600 dark:text-gray-400"
        >
          Sort by
        </label>
        <select
          id="agent-sort"
          aria-label="Sort by"
          value={sortKey}
          onChange={(event) => onSortChange(event.target.value as AgentSortKey)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
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
          onChange={(event) => onHideUnavailableChange(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700"
        />
        Hide unavailable agents
      </label>
    </div>
  );
}

function ResultsSummary({
  shown,
  total,
  formulaVersion,
}: {
  shown: number;
  total: number;
  formulaVersion: string | null;
}): ReactElement {
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      Showing {shown} of {total} ranked {total === 1 ? "agent" : "agents"}
      {formulaVersion !== null ? ` · formula ${formulaVersion}` : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Shared cells
// ---------------------------------------------------------------------------

/** Collapsible score total plus its component explanation. */
function ScoreDetails({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <details className="min-w-[3.5rem]">
      <summary className="cursor-pointer list-inside text-sm font-semibold text-gray-900 marker:text-gray-400 dark:text-gray-100">
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

function FulfillmentValue({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span>{formatFulfillmentRate(agent.fulfillmentRate)}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {agent.successfulRedemptions}/{agent.totalTerminalRedemptions} settled
      </span>
    </div>
  );
}

function DefaultsValue({ agent }: { agent: RankedAgent }): ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span>{agent.defaultedRedemptions}</span>
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
      <span>{formatCollateralRatioBips(agent.collateralRatioBips)}</span>
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
  "px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400";
const BODY_CELL = "px-3 py-3 align-top text-gray-900 dark:text-gray-100";

function LeaderboardTable({
  agents,
}: {
  agents: readonly RankedAgent[];
}): ReactElement {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">
          Agent reliability leaderboard, ranked highest score first. Scores are
          a heuristic, not a guarantee.
        </caption>
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th scope="col" className={HEAD_CELL}>
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
            <th scope="col" className={HEAD_CELL}>
              Avg settlement
            </th>
            <th scope="col" className={HEAD_CELL}>
              Availability
            </th>
            <th scope="col" className={HEAD_CELL}>
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
              className="border-b border-gray-100 dark:border-gray-800/60"
            >
              <td className={`${BODY_CELL} tabular-nums text-gray-500`}>
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
                <ScoreDetails agent={agent} />
              </td>
              <td className={BODY_CELL}>
                <FulfillmentValue agent={agent} />
              </td>
              <td className={BODY_CELL}>
                <DefaultsValue agent={agent} />
              </td>
              <td className={`${BODY_CELL} tabular-nums`}>
                {formatSettlementSeconds(agent.averageSettlementSeconds)}
              </td>
              <td className={BODY_CELL}>
                <AvailabilityBadge agent={agent} />
              </td>
              <td className={`${BODY_CELL} tabular-nums`}>
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
          className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                #{index + 1}
              </span>
              <AgentIdentity
                details={agent.details}
                agentVault={agent.agentVault}
                size="sm"
              />
            </div>
            <ScoreDetails agent={agent} />
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
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
