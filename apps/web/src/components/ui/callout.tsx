import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type CalloutTone = "info" | "warning" | "danger" | "success";

export type CalloutProps = {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const toneClasses: Record<CalloutTone, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  danger:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
};

/** Inline notice for error, warning, and informational states. */
export function Callout({
  tone = "info",
  title,
  children,
  actions,
  className,
}: CalloutProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-md border p-4 text-sm",
        toneClasses[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          {title !== undefined ? (
            <p className="font-semibold">{title}</p>
          ) : null}
          {children !== undefined ? (
            <div className={cn(title !== undefined && "mt-1")}>{children}</div>
          ) : null}
        </div>
        {actions !== undefined ? (
          <div className="shrink-0">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
