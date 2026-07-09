import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { StatusTone } from "@/lib/status";

export type BadgeProps = {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
};

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  progress: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  success:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warning:
    "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/** Compact status pill. Tone maps to the quiet operational palette. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
