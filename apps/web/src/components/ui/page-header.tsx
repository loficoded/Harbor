import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

/** Consistent per-route heading with optional description and actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        {description !== undefined ? (
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
