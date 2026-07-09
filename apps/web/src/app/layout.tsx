import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { NetworkGuard } from "@/components/network-guard";
import { Providers } from "@/components/providers";
import { WalletStatus } from "@/components/wallet-status";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Harbor",
  description:
    "Operational surface for FXRP redemption settlement and agent reliability on Flare Coston2.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <Providers>
          <AppShell headerRight={<WalletStatus />} banner={<NetworkGuard />}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
