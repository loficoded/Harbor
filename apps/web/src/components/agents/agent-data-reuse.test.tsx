import { AgentLeaderboard } from "@/components/agents/agent-leaderboard";
import { AgentPicker } from "@/components/redemption/agent-picker";
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
 * Regression guard for the shared agent data model: the home-page redemption
 * picker (Prompt #17) and the `/agents` leaderboard both read ranked agents
 * from `useRankedAgents`, so they must present the same agents in the same
 * ranking. Backends return agents score-descending; the picker preserves that
 * order and the leaderboard's default sort reproduces it.
 */
describe("agent ranking data reuse", () => {
  const response = agentsResponse([
    agentView({ agentVault: AGENT_B, score: 90, availableLots: "50" }),
    agentView({ agentVault: AGENT_C, score: 65, availableLots: "333" }),
    agentView({ agentVault: AGENT_A, score: 40, availableLots: "111" }),
  ]);

  it("renders the picker options in the same ranking as the leaderboard rows", async () => {
    const client = makeClient(
      vi.fn(async () => response) as unknown as GetAgents,
    );

    render(
      <div>
        <AgentPicker selectedAgent={null} onSelect={() => {}} client={client} />
        <AgentLeaderboard client={client} />
      </div>,
    );

    // Wait for both surfaces to finish loading the shared data.
    const table = await screen.findByRole("table");

    const pickerSelect = screen.getByRole("combobox", {
      name: /preferred agent/i,
    });
    const pickerVaults = within(pickerSelect)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value.startsWith("0x"));

    // Same set and count of agents on both surfaces.
    expect(pickerVaults).toEqual([AGENT_B, AGENT_C, AGENT_A]);

    // Same order in the leaderboard, compared by the vaults' unique suffixes.
    const rows = within(table).getAllByTestId("agent-row");
    expect(rows).toHaveLength(pickerVaults.length);
    pickerVaults.forEach((vault, index) => {
      expect(rows[index]).toHaveTextContent(new RegExp(vault.slice(-4)));
    });
  });

  it("shares the same score data on both surfaces", async () => {
    const client = makeClient(
      vi.fn(async () => response) as unknown as GetAgents,
    );

    render(
      <div>
        <AgentPicker selectedAgent={null} onSelect={() => {}} client={client} />
        <AgentLeaderboard client={client} />
      </div>,
    );

    const table = await screen.findByRole("table");
    const topRow = within(table).getAllByTestId("agent-row")[0];
    // The top-ranked agent's score (90) appears in both the leaderboard row
    // and the picker's option label for the same agent.
    expect(topRow).toHaveTextContent("90");

    const pickerSelect = screen.getByRole("combobox", {
      name: /preferred agent/i,
    });
    const topOption = within(pickerSelect)
      .getAllByRole("option")
      .find((option) => (option as HTMLOptionElement).value === AGENT_B);
    expect(topOption?.textContent).toContain("score 90");
  });
});
