import { EmptyState, PageHeader } from "@/components/ui";

type StatusPageProps = {
  params: { id: string };
};

export default function StatusPage({ params }: StatusPageProps) {
  const id = decodeURIComponent(params.id);

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
      <EmptyState
        title="Status view not implemented yet"
        description="This route is a placeholder. The redemption status timeline, XRPL receipts, and FDC proof state will render here in a later prompt."
      />
    </div>
  );
}
