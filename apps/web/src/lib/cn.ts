export type ClassValue = string | false | null | undefined;

/**
 * Join conditional class names, dropping falsy values. A deliberately tiny
 * local helper rather than a dependency: the shell only needs truthy-filtering
 * concatenation, not full `clsx`/`tailwind-merge` semantics.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
