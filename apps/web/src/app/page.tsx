import { RedemptionLookup } from "@/components/redemption-lookup";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <PageHeader
        title="Redemption console"
        description="Track FXRP redemption settlement and compare agent reliability on Flare Coston2."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Look up a redemption"
            description="Enter a redemption request id to open its settlement status."
          />
          <RedemptionLookup />
        </Card>

        <Card>
          <CardHeader
            title="Agents"
            description="Compare agent reliability before deciding where to redeem."
          />
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Ranked agent reliability is served from the Harbor backend. Scores
            are heuristic and intended for operational comparison only.
          </p>
          <Link
            href="/agents"
            className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            View agents
          </Link>
        </Card>
      </div>
    </div>
  );
}
