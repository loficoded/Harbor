import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ContainerWidth = "narrow" | "default" | "wide";

export type ContainerProps = {
  children: ReactNode;
  className?: string;
  /**
   * Reading width for the inner content:
   * - `narrow` (48rem) for dense, text-first detail pages,
   * - `default` (72rem) for standard content,
   * - `wide` (80rem) for the app frame and dashboard surfaces.
   */
  size?: ContainerWidth;
};

const sizeClasses: Record<ContainerWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
};

/**
 * Single source of truth for horizontal layout: a centered, responsive gutter
 * system shared by the app shell and every page. Replacing the previous
 * hard-coded `max-w-4xl` container everywhere lets desktop breakpoints use the
 * available width intentionally while narrow viewports keep comfortable gutters.
 */
export function Container({
  children,
  className,
  size = "wide",
}: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  );
}
