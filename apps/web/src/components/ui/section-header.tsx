import type { ReactNode } from "react";

export type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional small overline shown above the title. */
  eyebrow?: ReactNode;
};

/**
 * Section-level heading (`h2`) used to introduce the stacked overview sections
 * below the hero. Mirrors {@link PageHeader}'s rhythm one level down so the
 * page keeps a single, predictable heading hierarchy: one `h1` in the hero, an
 * `h2` per section, and `h3` inside cards.
 */
export function SectionHeader({
  title,
  description,
  actions,
  eyebrow,
}: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow !== undefined ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl dark:text-gray-100">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
