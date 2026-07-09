import { AppNav } from "@/components/app-nav";
import Link from "next/link";
import type { ReactNode } from "react";

export type AppShellProps = {
  children: ReactNode;
  /** Wallet controls rendered on the right of the header (client slot). */
  headerRight?: ReactNode;
  /** Full-width banner area below the header (e.g. the network guard). */
  banner?: ReactNode;
};

/**
 * Presentational application frame: brand, primary navigation, an injected
 * header-right slot for wallet controls, a banner slot for the network guard,
 * the routed page content, and a footer. Kept free of wallet/router hooks so it
 * renders in isolation; interactive, wagmi-dependent pieces are passed in as
 * slots by the root layout.
 */
export function AppShell({ children, headerRight, banner }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Harbor
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Coston2
            </span>
          </Link>
          <AppNav />
          {headerRight !== undefined ? (
            <div className="ml-auto flex items-center">{headerRight}</div>
          ) : null}
        </div>
      </header>

      {banner !== undefined ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4">{banner}</div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-gray-200 py-4 dark:border-gray-800">
        <div className="mx-auto w-full max-w-6xl px-4 text-xs text-gray-400">
          Harbor operates on the Flare Coston2 testnet. Redemption amounts and
          agent scores are heuristic and for operational use only.
        </div>
      </footer>
    </div>
  );
}
