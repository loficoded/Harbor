import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { coston2TransactionUrl } from "@/lib/chain";
import { formatAddress, formatHash } from "@/lib/format";

type StatusPageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Redemption status route. The full status timeline, XRPL receipts, and FDC
 * proof state are Prompt #18; this page confirms the submitted request(s) and
 * preserves the additional request ids, transaction hash, and preferred agent
 * that the redemption flow (Prompt #17) passes via query params so nothing is
 * lost on navigation.
 */
export default function StatusPage({ params, searchParams }: StatusPageProps) {
  const id = decodeURIComponent(params.id);

  const moreRaw = firstValue(searchParams?.["more"]);
  const additionalIds =
    moreRaw === undefined
      ? []
      : moreRaw
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value !== "");
  const transactionHash = firstValue(searchParams?.["tx"]);
  const preferredAgent = firstValue(searchParams?.["agent"]);

  return (
    <div>
      <PageHeader
        title="Redemption status"
        description={
          <>
            Request <span className="font-mono">{id}</span>
          </>
        }
      />

      {additionalIds.length > 0 ||
      transactionHash !== undefined ||
      preferredAgent !== undefined ? (
        <Card className="mb-4">
          <CardHeader
            title="Submission details"
            description="Preserved from the redemption submission."
          />
          <dl className="flex flex-col gap-2 text-sm">
            {transactionHash !== undefined ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">
                  Transaction
                </dt>
                <dd>
                  <a
                    href={coston2TransactionUrl(transactionHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-accent hover:underline"
                  >
                    {formatHash(transactionHash)}
                  </a>
                </dd>
              </div>
            ) : null}
            {additionalIds.length > 0 ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">
                  Additional request ids
                </dt>
                <dd className="font-mono">{additionalIds.join(", ")}</dd>
              </div>
            ) : null}
            {preferredAgent !== undefined ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">
                  Preferred agent
                </dt>
                <dd className="font-mono">{formatAddress(preferredAgent)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <EmptyState
        title="Live status tracking is coming soon"
        description="The redemption status timeline, XRPL receipts, and FDC proof state will render here. Recovery is not complete until backend status confirms it."
      />
    </div>
  );
}
