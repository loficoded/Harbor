import { ArrowDownIcon, CheckIcon } from "@/components/overview/icons";

const MANUAL_STEPS = [
  "Watch for payment",
  "Spot the miss",
  "Gather evidence",
  "Claim in time",
] as const;

const overlineClass = "text-[11px] font-semibold uppercase tracking-wider";

/**
 * Side-by-side contrast between the manual, deadline-bound path a redeemer
 * would otherwise walk and Harbor's single step. Purely presentational; it
 * frames the value proposition next to the hero copy and carries no live state.
 */
export function ComparisonCard() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-gray-50/80 p-5 dark:border-gray-800 dark:bg-gray-950/40">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        If a payout doesn&rsquo;t arrive
      </h2>

      <div className="mt-4">
        <p className={`${overlineClass} text-gray-400 dark:text-gray-500`}>
          On your own
        </p>
        <ul className="mt-2.5 grid grid-cols-2 gap-2">
          {MANUAL_STEPS.map((step) => (
            <li
              key={step}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
            >
              {step}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">
          Four manual steps, on a deadline.
        </p>
      </div>

      <div className="my-4 flex items-center justify-center text-gray-300 dark:text-gray-600">
        <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
      </div>

      <div className="rounded-lg border border-accent/20 bg-accent/[0.06] p-4">
        <p className={`${overlineClass} text-accent`}>With Harbor</p>
        <div className="mt-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-sm">
            <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
            You redeem
          </span>
        </div>
        <p className="mt-2.5 text-xs text-gray-600 dark:text-gray-300">
          One step. Harbor does the rest, automatically.
        </p>
      </div>
    </div>
  );
}
