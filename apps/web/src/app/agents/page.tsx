import { AgentLeaderboard } from "@/components/agents";
import { PageHeader } from "@/components/ui";

/**
 * Agent statistics route. Renders the observed agent reliability analytics
 * (`GET /agents`) via the client container, which loads the shared ranked-agent
 * data model, applies sorting/filtering, and renders a responsive table/cards
 * layout.
 *
 * This page is informational only. Agent selection for redemptions is handled
 * automatically by the FAssets protocol using FIFO; nothing here influences
 * which agent fulfills a redemption. Scores are a transparent heuristic, not a
 * guarantee.
 */
export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="FXRP · Coston2"
        title="Agent statistics"
        description="Observed agent reliability analytics for FXRP on Coston2 — settlement history, availability, collateral, and heuristic scores. Informational only; it does not affect redemption assignment."
      />
      <AgentLeaderboard />
    </div>
  );
}
