"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

const navLinks: readonly NavLink[] = [
  { href: "/", label: "Overview" },
  { href: "/agents", label: "Agents" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Primary navigation as a compact segmented control. A subtle inset track
 * groups the destinations and the active route reads as a raised pill, so the
 * current location is obvious at a glance (recognition over recall) without
 * adding chrome. Stretches to full width on phones where the shell drops it to
 * its own row.
 */
export function AppNav() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary"
      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-100/70 p-1 dark:border-gray-800 dark:bg-gray-800/40"
    >
      {navLinks.map((link) => {
        const active = isActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3.5 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none",
              active
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-700"
                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
