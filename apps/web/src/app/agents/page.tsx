import { EmptyState, PageHeader } from "@/components/ui";

export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        title="Agents"
        description="Ranked agent reliability for FXRP redemptions on Coston2."
      />
      <EmptyState
        title="Agent comparison is coming soon"
        description="The agent reliability leaderboard will render here. Scores are heuristic and served from the Harbor backend."
      />
    </div>
  );
}
