import { RedemptionForm } from "@/components/redemption";
import { RedemptionLookup } from "@/components/redemption-lookup";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <PageHeader
        title="Redemption console"
        description="Redeem FXRP for underlying XRP on Flare Coston2 and track settlement."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Redeem FXRP"
              description="Burn FXRP to receive XRP at your destination address. Approve the AssetManager, then submit the redemption."
            />
            <RedemptionForm />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Look up a redemption"
              description="Open the settlement status for an existing request id."
            />
            <RedemptionLookup />
          </Card>

          <Card>
            <CardHeader
              title="Agent statistics"
              description="Observed agent reliability analytics."
            />
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Ranked agent reliability is served from the Harbor backend. It is
              informational only — the FAssets protocol assigns redemption
              agents automatically (FIFO), so these stats do not influence which
              agent fulfills a redemption.
            </p>
            <Link
              href="/agents"
              className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              View agent statistics
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
