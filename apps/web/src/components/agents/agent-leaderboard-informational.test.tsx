import { AgentLeaderboard } from "@/components/agents/agent-leaderboard";
import type { HarborApiClient } from "@/lib/api-client";
import {
  AGENT_A,
  AGENT_B,
  AGENT_C,
  agentsResponse,
  agentView,
} from "@/test/agents-fixtures";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type GetAgents = HarborApiClient["getAgents"];

function makeClient(getAgents: GetAgents): HarborApiClient {
  return { getAgents } as unknown as HarborApiClient;
}

/**
 * The `/agents` leaderboard is informational analytics only. The FAssets
 * protocol assigns redemption agents automatically (FIFO), so the leaderboard
 * must never expose a control that lets a user choose, prefer, or target an
 * agent for a redemption. These are the component-level guards for that
 * repositioning; the E2E suite covers the same at the page level.
 */
describe("AgentLeaderboard — informational analytics only", () => {
  const response = agentsResponse([
    agentView({ agentVault: AGENT_B, score: 90, availableLots: "50" }),
    agentView({ agentVault: AGENT_C, score: 65, availableLots: "333" }),
    agentView({ agentVault: AGENT_A, score: 40, availableLots: "111" }),
  ]);

  function renderLeaderboard() {
    const client = makeClient(
      vi.fn(async () => response) as unknown as GetAgents,
    );
    return render(<AgentLeaderboard client={client} />);
  }

  it("shows the FIFO notice explaining the protocol assigns agents", async () => {
    renderLeaderboard();
    await screen.findByRole("table");

    expect(
      screen.getByText(
        /handled automatically by the FAssets protocol using FIFO/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not affect assignment/i)).toBeInTheDocument();
  });

  it("renders agents in backend ranking order (analytics, not a picker)", async () => {
    renderLeaderboard();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByTestId("agent-row");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/00b2/); // score 90
    expect(rows[1]).toHaveTextContent(/00c3/); // score 65
    expect(rows[2]).toHaveTextContent(/00a1/); // score 40
  });

  it("exposes no agent-selection control or CTA", async () => {
    renderLeaderboard();
    await screen.findByRole("table");

    // No preferred-agent selector.
    expect(
      screen.queryByRole("combobox", { name: /preferred agent/i }),
    ).toBeNull();

    // None of the misleading selection phrases appear anywhere on the page.
    for (const phrase of [
      /preferred agent/i,
      /choose (an |your )?agent/i,
      /select agent/i,
      /redeem with this agent/i,
      /prefer this agent/i,
    ]) {
      expect(screen.queryByText(phrase)).toBeNull();
    }

    // The only selects are the analytics sort control — never an agent picker.
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]).toHaveAccessibleName(/sort by/i);
  });
});
