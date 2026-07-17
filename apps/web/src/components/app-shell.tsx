import { AppNav } from "@/components/app-nav";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import type { ReactNode } from "react";

export type AppShellProps = {
  children: ReactNode;
  /** Wallet controls rendered on the right of the header (client slot). */
  headerRight?: ReactNode;
  /** Full-width banner area below the header (e.g. the network guard). */
  banner?: ReactNode;
};

/** Restrained wordmark lockup with a small accent glyph hinting at a harbor. */
function Brand() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/20"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 7v12M12 19c-3.6 0-6.5-2.9-6.5-6.5M12 19c3.6 0 6.5-2.9 6.5-6.5M7 10H5.5M12 10h0M17 10h1.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Harbor
        </span>
        <span className="hidden rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 sm:inline dark:border-gray-700 dark:text-gray-500">
          Coston2
        </span>
      </span>
    </Link>
  );
}

/**
 * Presentational application frame. A sticky, full-bleed header carries the
 * brand, primary navigation, and an injected wallet slot; the banner, routed
 * content, and footer all align to one shared responsive {@link Container} so
 * every surface uses the available width intentionally instead of stacking
 * inside a single narrow column. Kept free of wallet/router hooks so it renders
 * in isolation; interactive pieces are passed in as slots by the root layout.
 */
export function AppShell({ children, headerRight, banner }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-gray-800 dark:bg-gray-900/85 dark:supports-[backdrop-filter]:bg-gray-900/70">
        <Container>
          <div className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-3 py-3">
            <div className="order-1">
              <Brand />
            </div>
            {headerRight !== undefined ? (
              <div className="order-2 ml-auto flex items-center sm:order-3">
                {headerRight}
              </div>
            ) : null}
            {/* One nav instance: full-width second row on phones, inline on sm+. */}
            <div className="order-3 w-full sm:order-2 sm:w-auto">
              <AppNav />
            </div>
          </div>
        </Container>
      </header>

      {banner !== undefined ? (
        <Container className="pt-4 empty:hidden">{banner}</Container>
      ) : null}

      <main className="flex-1 py-8 sm:py-10 lg:py-12">
        <Container>{children}</Container>
      </main>

      <footer className="mt-4 border-t border-gray-200 py-6 dark:border-gray-800">
        <Container className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">
          Harbor operates on the Flare Coston2 testnet. Redemption amounts and
          agent scores are heuristic and for operational use only.
        </Container>
      </footer>
    </div>
  );
}
