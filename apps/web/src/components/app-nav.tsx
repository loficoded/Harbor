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

/** Primary navigation with active-route highlighting. */
export function AppNav() {
  const pathname = usePathname() ?? "/";

  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {navLinks.map((link) => {
        const active = isActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent/10 text-accent"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
