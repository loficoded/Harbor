import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent/90",
  secondary:
    "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 " +
    "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800",
  ghost:
    "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Explicit `| undefined` so callers can forward an optional className under
  // the project's `exactOptionalPropertyTypes` setting.
  className?: string | undefined;
};

/**
 * Compose the shared control styling. Exported so link-based actions (e.g. the
 * hero CTAs rendered as `<a>`/`next/link`) can look and focus exactly like a
 * {@link Button} without duplicating class strings or nesting a button in a
 * link.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: ButtonClassOptions = {}): string {
  return cn(base, variantClasses[variant], sizeClasses[size], className);
}

/** Primary interactive control for the shell. Server/client safe. */
export function Button({
  variant = "primary",
  size = "md",
  type,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
