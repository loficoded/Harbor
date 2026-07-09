import { cn } from "@/lib/cn";

export type SpinnerProps = {
  label?: string;
  className?: string;
};

/** Accessible inline loading indicator with a visible status label. */
export function Spinner({ label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-300"
      />
      <span>{label}</span>
    </span>
  );
}
