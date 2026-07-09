import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type CardProps = {
  children: ReactNode;
  className?: string;
};

/** Neutral surface container used to group operational panels. */
export function Card({ children, className }: CardProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-gray-200 bg-white p-5 shadow-sm",
        "dark:border-gray-800 dark:bg-gray-900",
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
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
