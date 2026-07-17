import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional small overline shown above the title. */
  eyebrow?: ReactNode;
};

/** Consistent per-route heading with optional description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow !== undefined ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl dark:text-gray-100">
          {title}
        </h1>
        {description !== undefined ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="shrink-0 sm:pb-1">{actions}</div>
      ) : null}
    </header>
  );
}
