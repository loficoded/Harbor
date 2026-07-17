import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type CardProps = {
  children: ReactNode;
  className?: string;
  /** Inner padding scale. `none` lets callers control their own padding. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Adds a subtle hover elevation for interactive/linked cards. */
  interactive?: boolean;
};

const paddingClasses: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6 sm:p-7",
};

/** Neutral surface container used to group operational panels. */
export function Card({
  children,
  className,
  padding = "md",
  interactive = false,
}: CardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-gray-200 bg-white shadow-sm",
        "dark:border-gray-800 dark:bg-gray-900",
        interactive &&
          "transition-shadow transition-colors hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700",
        paddingClasses[padding],
        className,
      )}
    >
      {children}
    </section>
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

/** Consistent card heading with optional description and trailing actions. */
export function CardHeader({ title, description, actions }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
