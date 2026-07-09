import { RedemptionStatus } from "@/components/status";
import { parseAdditionalRequestIds } from "@/lib/redemption-status";

type StatusPageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Live redemption status route (Prompt #18). This server component parses the
 * request id and the query params the redemption flow (Prompt #17) preserves —
 * additional request ids (`more`), the redeem transaction hash (`tx`), and the
 * preferred agent (`agent`) — and hands them to the client container, which
 * fetches `GET /redemptions/:id`, polls until terminal, and renders the status
 * timeline, settlement receipt, and default-recovery detail.
 */
export default function StatusPage({ params, searchParams }: StatusPageProps) {
  const requestId = decodeURIComponent(params.id).trim();
  const additionalRequestIds = parseAdditionalRequestIds(
    firstValue(searchParams?.["more"]),
  );
  const transactionHash = firstValue(searchParams?.["tx"]) ?? null;
  const preferredAgent = firstValue(searchParams?.["agent"]) ?? null;

  return (
    <RedemptionStatus
      requestId={requestId}
      additionalRequestIds={additionalRequestIds}
      transactionHash={transactionHash}
      preferredAgent={preferredAgent}
    />
  );
}
