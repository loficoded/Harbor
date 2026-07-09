import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Neutral placeholder for routes and panels that have no data yet. Used by the
 * placeholder routes this prompt introduces.
 */
export function EmptyState({
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed " +
          "border-gray-300 bg-white/50 px-6 py-12 text-center " +
          "dark:border-gray-700 dark:bg-gray-900/50",
        className,
      )}
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </p>
      {description !== undefined ? (
        <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
          {description}
        </p>
      ) : null}
      {children !== undefined ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
