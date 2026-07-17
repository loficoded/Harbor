import { cn } from "@/lib/cn";

/**
 * Shared form-control styling. Text inputs, selects, and the search field all
 * derive from one token set so focus rings, borders, radii, and dark-mode
 * treatment stay identical across the redemption form, the redemption lookup,
 * and the agent leaderboard controls — previously each hand-rolled its own
 * near-identical class string.
 */
const controlBase =
  "w-full rounded-md border border-gray-300 bg-white text-sm text-gray-900 " +
  "shadow-sm transition-colors placeholder:text-gray-400 " +
  "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500";

export function inputClasses(className?: string): string {
  return cn(controlBase, "h-10 px-3", className);
}

export function selectClasses(className?: string): string {
  return cn(controlBase, "h-10 px-3 pr-9", className);
}

/** Small helper for the consistent field label used above controls. */
export function fieldLabelClasses(className?: string): string {
  return cn("text-xs font-medium text-gray-600 dark:text-gray-400", className);
}
