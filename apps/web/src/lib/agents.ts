import type { AgentDetails, SerializedAgentScoreView } from "@harbor/shared";

import { formatAddress } from "@/lib/format";
import type { StatusTone } from "@/lib/status";

/**
 * Canonical ranked-agent record backing the `/agents` statistics page. It is
 * the JSON-safe view returned by `GET /agents` verbatim — bigint amounts arrive
 * as decimal strings and `ftsoStatus` carries the freshness of any FTSO-derived
 * field. This is analytics data only; it is not used to select or influence the
 * agent that fulfills a redemption (the FAssets protocol assigns agents FIFO).
 */
export type RankedAgent = SerializedAgentScoreView;

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** User-selectable leaderboard orderings. */
export type AgentSortKey = "score" | "availableLots" | "settlement";

export const DEFAULT_AGENT_SORT: AgentSortKey = "score";

export const agentSortOptions: readonly Readonly<{
  value: AgentSortKey;
  label: string;
}>[] = [
  { value: "score", label: "Highest score" },
  { value: "availableLots", label: "Most available lots" },
  { value: "settlement", label: "Fastest average settlement" },
];

/** Parse a serialized bigint lot count for comparison; invalid values sort as 0. */
function lotsValue(agent: RankedAgent): bigint {
  try {
    return BigInt(agent.availableLots);
  } catch {
    return 0n;
  }
}

/** Deterministic tiebreak so equal keys never reshuffle between renders. */
function byVault(a: RankedAgent, b: RankedAgent): number {
  if (a.agentVault === b.agentVault) {
    return 0;
  }
  return a.agentVault < b.agentVault ? -1 : 1;
}

/**
 * Non-mutating ranking. The backend already returns score-descending order, but
 * re-sorting here keeps the leaderboard correct under client-side re-ordering
 * and applies a stable vault-address tiebreak. `settlement` orders by fastest
 * average first with agents that have no settlement history (`null`) placed
 * last regardless of direction, since "unknown" should never rank as "fastest".
 */
export function sortAgents(
  agents: readonly RankedAgent[],
  key: AgentSortKey = DEFAULT_AGENT_SORT,
): RankedAgent[] {
  const copy = [...agents];

  switch (key) {
    case "availableLots":
      return copy.sort((a, b) => {
        const av = lotsValue(a);
        const bv = lotsValue(b);
        return av === bv ? byVault(a, b) : av > bv ? -1 : 1;
      });
    case "settlement":
      return copy.sort((a, b) => {
        const as = a.averageSettlementSeconds;
        const bs = b.averageSettlementSeconds;
        if (as === null && bs === null) {
          return byVault(a, b);
        }
        if (as === null) {
          return 1;
        }
        if (bs === null) {
          return -1;
        }
        return as === bs ? byVault(a, b) : as - bs;
      });
    case "score":
    default:
      return copy.sort((a, b) =>
        a.score === b.score ? byVault(a, b) : b.score - a.score,
      );
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export type AgentFilter = Readonly<{
  hideUnavailable: boolean;
  /**
   * Free-text query matched against the agent's official name and vault
   * address (case-insensitive). Optional so existing call sites that only pass
   * `hideUnavailable` keep working; an empty/absent query is a no-op.
   */
  query?: string;
}>;

export const DEFAULT_AGENT_FILTER: AgentFilter = {
  hideUnavailable: false,
  query: "",
};

/** An agent is treated as available only when the backend flags it AVAILABLE. */
export function isAgentAvailable(agent: RankedAgent): boolean {
  return agent.availability === "AVAILABLE";
}

/** Whether an agent matches a normalized search query (name or vault address). */
function matchesQuery(agent: RankedAgent, normalizedQuery: string): boolean {
  if (normalizedQuery === "") {
    return true;
  }
  const name = officialAgentName(agent.details);
  if (name !== null && name.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  return agent.agentVault.toLowerCase().includes(normalizedQuery);
}

export function filterAgents(
  agents: readonly RankedAgent[],
  filter: AgentFilter,
): RankedAgent[] {
  const normalizedQuery = (filter.query ?? "").trim().toLowerCase();
  const availabilityFiltered = filter.hideUnavailable
    ? agents.filter(isAgentAvailable)
    : [...agents];

  return normalizedQuery === ""
    ? availabilityFiltered
    : availabilityFiltered.filter((agent) =>
        matchesQuery(agent, normalizedQuery),
      );
}

/** Sort then filter (filtering after the sort keeps the ranking stable). */
export function rankAgents(
  agents: readonly RankedAgent[],
  sortKey: AgentSortKey,
  filter: AgentFilter,
): RankedAgent[] {
  return filterAgents(sortAgents(agents, sortKey), filter);
}

// ---------------------------------------------------------------------------
// Official agent details (AgentOwnerRegistry)
// ---------------------------------------------------------------------------

/**
 * Details as they may arrive on the wire: an `AgentDetails` object, or absent
 * entirely from an older/partial payload. Helpers accept the loose shape and
 * degrade gracefully so rendering never depends on the field being present.
 */
export type MaybeAgentDetails = AgentDetails | null | undefined;

/**
 * The agent's official display name, trimmed, or `null` when unset. Whitespace
 * and empty strings collapse to `null` so they trigger the address fallback.
 */
export function officialAgentName(details: MaybeAgentDetails): string | null {
  const raw = details?.name;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether an agent has a usable official name (vs. falling back to address). */
export function hasOfficialAgentName(details: MaybeAgentDetails): boolean {
  return officialAgentName(details) !== null;
}

/**
 * Name to display for an agent: the official name when present, otherwise the
 * truncated vault address — the exact behavior in use before official details
 * existed, so the fallback is a pure no-op on legacy data.
 */
export function agentDisplayName(
  details: MaybeAgentDetails,
  agentVault: string,
): string {
  return officialAgentName(details) ?? formatAddress(agentVault);
}

/**
 * A safe, renderable icon URL, or `null` when none is usable. Only absolute
 * `http`/`https` URLs are accepted; anything else (empty, relative, `data:`,
 * `javascript:`, `ipfs:`, malformed) collapses to `null` so callers fall back
 * to a monogram. This guards against unsafe or unrenderable `<img>` sources
 * coming from agent-controlled on-chain metadata.
 */
export function resolveAgentIconUrl(details: MaybeAgentDetails): string | null {
  const raw = details?.iconUrl;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * A safe terms-of-use URL for linking, or `null`. Same `http`/`https`-only
 * validation as the icon URL.
 */
export function resolveAgentTermsOfUseUrl(
  details: MaybeAgentDetails,
): string | null {
  const raw = details?.termsOfUseUrl;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * A single-character monogram for an agent's fallback avatar. Uses the first
 * alphanumeric character of the official name when present, otherwise the first
 * hex character of the vault address, so every agent renders a stable initial
 * even without an icon.
 */
export function agentMonogram(
  details: MaybeAgentDetails,
  agentVault: string,
): string {
  const name = officialAgentName(details);
  if (name !== null) {
    const alphanumeric = name.match(/[\p{L}\p{N}]/u);
    return (alphanumeric?.[0] ?? name[0] ?? "?").toUpperCase();
  }
  const hex = agentVault.startsWith("0x") ? agentVault.slice(2) : agentVault;
  return (hex[0] ?? "?").toUpperCase();
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function agentAvailabilityLabel(availability: string): string {
  switch (availability) {
    case "AVAILABLE":
      return "Available";
    case "UNAVAILABLE":
      return "Unavailable";
    default:
      return "Unknown";
  }
}

export function agentAvailabilityTone(availability: string): StatusTone {
  switch (availability) {
    case "AVAILABLE":
      return "success";
    case "UNAVAILABLE":
      return "warning";
    default:
      return "neutral";
  }
}

/** Group-separated lot count for scanning; falls back to the raw string. */
export function formatLots(lots: string): string {
  try {
    return BigInt(lots).toLocaleString("en-US");
  } catch {
    return lots;
  }
}

/** Fulfillment ratio (0..1) as a whole-percent string, or an em dash if null. */
export function formatFulfillmentRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
}

/** Compact duration for an average settlement time in seconds. */
export function formatSettlementSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const total = Math.round(seconds);
  if (total < 60) {
    return `${total}s`;
  }
  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return secs === 0 ? `${minutes}m` : `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Collateral ratio (basis points) as a percentage, or an em dash if unknown. */
export function formatCollateralRatioBips(bips: string | null): string {
  if (bips === null) {
    return "—";
  }
  try {
    const percent = Number(BigInt(bips)) / 100;
    if (!Number.isFinite(percent)) {
      return "—";
    }
    // Trim trailing zeros: 25000 -> "250%", 12550 -> "125.5%".
    return `${Number(percent.toFixed(2))}%`;
  } catch {
    return "—";
  }
}

export function collateralSourceLabel(source: string): string {
  switch (source) {
    case "INVENTORY":
      return "On-chain inventory";
    case "FTSO_DERIVED":
      return "FTSO-derived";
    default:
      return "Unavailable";
  }
}

/** A small caveat badge attached to a field the score depends on. */
export type FieldIndicator = Readonly<{
  label: string;
  tone: StatusTone;
  /** Longer explanation for a tooltip / accessible description. */
  title: string;
}>;

/**
 * Staleness / availability caveat for an agent's collateral ratio — the only
 * FTSO-derived field surfaced on the leaderboard.
 *
 * When the ratio was derived from FTSO prices, the snapshot's freshness
 * (`ftsoStatus`) decides trust: a `STALE` or `FAILED` snapshot is flagged so an
 * outdated value is never shown as current. When the ratio could not be
 * determined at all it is flagged unavailable. Inventory-sourced ratios carry
 * no FTSO caveat and return `null`.
 */
export function collateralFieldIndicator(
  agent: RankedAgent,
): FieldIndicator | null {
  const { collateralRatioSource, collateralRatioBips, ftsoStatus } = agent;

  if (collateralRatioSource === "UNAVAILABLE" || collateralRatioBips === null) {
    return {
      label: "Unavailable",
      tone: "neutral",
      title: "Collateral ratio is unavailable for scoring.",
    };
  }

  if (collateralRatioSource === "FTSO_DERIVED") {
    if (ftsoStatus === "STALE") {
      return {
        label: "Stale",
        tone: "warning",
        title:
          "The FTSO price feed is older than the accepted window; this FTSO-derived collateral ratio may be outdated.",
      };
    }
    if (ftsoStatus === "FAILED") {
      return {
        label: "FTSO unavailable",
        tone: "warning",
        title:
          "The FTSO price feed could not be read; this FTSO-derived collateral ratio may be outdated.",
      };
    }
    if (ftsoStatus === "UNAVAILABLE") {
      return {
        label: "FTSO unavailable",
        tone: "neutral",
        title: "No FTSO price feed was available for this collateral ratio.",
      };
    }
  }

  return null;
}

/** One weighted term of the reliability score, for the breakdown explanation. */
export type ScoreComponent = Readonly<{
  key: string;
  label: string;
  value: number;
  /** Whether the term adds to or subtracts from the total score. */
  effect: "add" | "subtract";
}>;

/**
 * Transparent breakdown of how a score was composed. Presented next to the
 * total so the ranking is explainable rather than a black box. Values mirror
 * the backend scoring record; the default penalty subtracts from the total.
 */
export function scoreBreakdown(agent: RankedAgent): readonly ScoreComponent[] {
  return [
    {
      key: "fulfillment",
      label: "Fulfillment",
      value: agent.fulfillmentScore,
      effect: "add",
    },
    {
      key: "settlement",
      label: "Settlement time",
      value: agent.settlementTimeScore,
      effect: "add",
    },
    {
      key: "availability",
      label: "Availability",
      value: agent.availabilityScore,
      effect: "add",
    },
    {
      key: "collateral",
      label: "Collateral",
      value: agent.collateralScore,
      effect: "add",
    },
    {
      key: "default",
      label: "Default penalty",
      value: agent.defaultPenalty,
      effect: "subtract",
    },
  ];
}

/**
 * Single-line, signed rendering of the score breakdown, e.g.
 * `"Fulfillment +40 · Settlement time +20 · … · Default penalty −0"`. Used as
 * the score component explanation shown next to each total.
 */
export function formatScoreBreakdown(agent: RankedAgent): string {
  return scoreBreakdown(agent)
    .map(
      (component) =>
        `${component.label} ${component.effect === "subtract" ? "−" : "+"}${
          component.value
        }`,
    )
    .join(" · ");
}
