/**
 * Small, dependency-free display helpers shared across the shell. Kept pure so
 * they can be unit tested and reused by later prompts without pulling in React.
 */

/** Collapse a long string to `lead…tail` form (e.g. addresses, tx hashes). */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) {
    return value;
  }

  return `${value.slice(0, lead)}…${value.slice(value.length - tail)}`;
}

/** Format a 0x EVM address for compact display. */
export function formatAddress(address: string): string {
  return truncateMiddle(address, 6, 4);
}

/** Format a transaction or reference hash for compact display. */
export function formatHash(hash: string): string {
  return truncateMiddle(hash, 10, 8);
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Compact, locale-independent "time ago" label for a past instant. Used by the
 * status view's freshness indicator, so it stays deterministic (no `Intl`,
 * no timezone) and readable at a glance. A `from` in the (near) future is
 * clamped to "just now" to absorb small client/server clock skew.
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diff = nowMs - fromMs;

  if (!Number.isFinite(diff) || diff < 5 * MS_PER_SECOND) {
    return "just now";
  }
  if (diff < MS_PER_MINUTE) {
    return `${Math.floor(diff / MS_PER_SECOND)}s ago`;
  }
  if (diff < MS_PER_HOUR) {
    return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
  }
  if (diff < MS_PER_DAY) {
    return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
  }
  return `${Math.floor(diff / MS_PER_DAY)}d ago`;
}

/**
 * Render an ISO timestamp as a stable `YYYY-MM-DD HH:MM:SS UTC` string. The
 * backend stores UTC instants, so formatting in UTC keeps receipts unambiguous
 * and keeps rendering deterministic across machines and test environments
 * (unlike `toLocaleString`). Returns the raw input unchanged when it is not a
 * parseable date, so a malformed value degrades gracefully instead of showing
 * "Invalid Date".
 */
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const pad = (value: number): string => value.toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}
