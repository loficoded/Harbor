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
