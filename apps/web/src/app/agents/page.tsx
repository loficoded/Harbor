import { AgentLeaderboard } from "@/components/agents";
import { PageHeader } from "@/components/ui";

/**
 * Agent leaderboard route. Renders the ranked agent reliability comparison
 * (`GET /agents`) via the client container, which loads the shared ranked-agent
 * data model, applies sorting/filtering, and renders a responsive
 * table/cards layout. Scores are presented as a heuristic, not a guarantee.
 */
export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        title="Agents"
        description="Compare agent reliability before choosing where to redeem FXRP on Coston2. Scores are heuristic."
      />
      <AgentLeaderboard />
    </div>
  );
}
