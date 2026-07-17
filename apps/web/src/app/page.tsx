import { Hero, SafetySection, StepsSection } from "@/components/overview";
import { RedemptionForm } from "@/components/redemption";
import { RedemptionLookup } from "@/components/redemption-lookup";
import { Card, CardHeader, SectionHeader } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";

/**
 * Overview route. The page is ordered to answer the reader's questions in the
 * order they ask them — what Harbor is and why it exists (hero), how it works
 * (process timeline), why it can be trusted (safety guarantees), and finally
 * what to do next (the live redemption console). The hero and the console read
 * as balanced two-zone bands on wide screens, while the process and safety rows
 * spread across the full width instead of stacking inside a narrow column;
 * everything collapses to a single stack on narrow viewports. The marketing
 * sections are static server components; only the console mounts wallet-aware
 * client widgets.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      <Hero />

      <StepsSection />

      <SafetySection />

      <section id="redeem" className="scroll-mt-24">
        <SectionHeader
          eyebrow="Console"
          title="Redemption console"
          description="Redeem FXRP for underlying XRP on Flare Coston2 and track settlement to its final outcome."
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card padding="lg">
              <CardHeader
                title="Redeem FXRP"
                description="Burn FXRP to receive XRP at your destination address. Approve the AssetManager, then submit the redemption."
              />
              <RedemptionForm />
            </Card>
          </div>

          <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            <Card padding="lg">
              <CardHeader
                title="Look up a redemption"
                description="Open the settlement status for an existing request id."
              />
              <RedemptionLookup />
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Agent statistics"
                description="Observed agent reliability analytics."
              />
              <p className="mb-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                Ranked agent reliability is served from the Harbor backend. It
                is informational only — the FAssets protocol assigns redemption
                agents automatically (FIFO), so these stats do not influence
                which agent fulfills a redemption.
              </p>
              <Link
                href="/agents"
                className={buttonClasses({
                  variant: "secondary",
                  className: "w-full",
                })}
              >
                View agent statistics
              </Link>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
