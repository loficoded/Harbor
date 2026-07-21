import { RedemptionStatus } from "@/components/status";
import { parseAdditionalRequestIds } from "@/lib/redemption-status";

// Next 15 makes route `params`/`searchParams` async (Promises) for pages.
type StatusPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Live redemption status route (Prompt #18). This server component parses the
 * request id and the query params the redemption flow (Prompt #17) preserves —
 * additional request ids (`more`) and the redeem transaction hash (`tx`) — and
 * hands them to the client container, which fetches `GET /redemptions/:id`,
 * polls until terminal, and renders the status timeline, settlement receipt,
 * and default-recovery detail.
 *
 * No agent is read from the URL: the FAssets protocol assigns redemption
 * agents FIFO, so the assigned agent is taken from indexed protocol data in the
 * redemption response rather than from the submission.
 */
export default async function StatusPage({
  params,
  searchParams,
}: StatusPageProps) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestId = decodeURIComponent(id).trim();
  const additionalRequestIds = parseAdditionalRequestIds(
    firstValue(resolvedSearchParams["more"]),
  );
  const transactionHash = firstValue(resolvedSearchParams["tx"]) ?? null;

  return (
    <RedemptionStatus
      requestId={requestId}
      additionalRequestIds={additionalRequestIds}
      transactionHash={transactionHash}
    />
  );
}
