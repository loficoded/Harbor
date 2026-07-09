import { AgentPicker } from "@/components/redemption/agent-picker";
import type { HarborApiClient } from "@/lib/api-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

type GetAgents = HarborApiClient["getAgents"];

/** Build a stand-in client exposing only the `getAgents` method the picker uses. */
function makeClient(getAgents: GetAgents): HarborApiClient {
  return { getAgents } as unknown as HarborApiClient;
}

function agentsResponse(
  agents: ReadonlyArray<{
    agentVault: string;
    score: number;
    availableLots: string;
    availability: string;
  }>,
) {
  return {
    asset: "FXRP",
    scoreIsHeuristic: true as const,
    agents,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AgentPicker load states", () => {
  it("shows a loading indicator while the request is in flight", () => {
    const client = makeClient(
      vi.fn(() => new Promise(() => {})) as unknown as GetAgents,
    );

    render(<AgentPicker selectedAgent={null} onSelect={() => {}} client={client} />);

    expect(screen.getByText("Loading agents…")).toBeInTheDocument();
  });

  it("shows an empty note but still allows redeeming without a preference", async () => {
    const client = makeClient(
      vi.fn(async () => agentsResponse([])) as unknown as GetAgents,
    );

    render(<AgentPicker selectedAgent={null} onSelect={() => {}} client={client} />);

    expect(
      await screen.findByText(/no ranked agents are available yet/i),
    ).toBeInTheDocument();
    // The "no preference" default option is always present.
    expect(screen.getByRole("combobox", { name: /preferred agent/i })).toBeInTheDocument();
  });

  it("renders an error state with a retry action", async () => {
    const getAgents = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce(
        agentsResponse([
          {
            agentVault: "0x00000000000000000000000000000000000000a1",
            score: 87,
            availableLots: "12",
            availability: "AVAILABLE",
          },
        ]),
      );
    const client = makeClient(getAgents as unknown as GetAgents);

    render(<AgentPicker selectedAgent={null} onSelect={() => {}} client={client} />);

    expect(
      await screen.findByText("Could not load agents"),
    ).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable/i)).toBeInTheDocument();

    // Retrying re-requests and recovers to the ready state.
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    expect(getAgents).toHaveBeenCalledTimes(2);
  });

  it("lists ranked agents and reports the selected preference", async () => {
    const onSelect = vi.fn();
    const client = makeClient(
      vi.fn(async () =>
        agentsResponse([
          {
            agentVault: "0x00000000000000000000000000000000000000a1",
            score: 87,
            availableLots: "12",
            availability: "AVAILABLE",
          },
          {
            agentVault: "0x00000000000000000000000000000000000000b2",
            score: 64,
            availableLots: "3",
            availability: "UNAVAILABLE",
          },
        ]),
      ) as unknown as GetAgents,
    );

    render(
      <AgentPicker selectedAgent={null} onSelect={onSelect} client={client} />,
    );

    const select = await screen.findByRole("combobox", {
      name: /preferred agent/i,
    });
    // No preference + two agents.
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await userEvent.selectOptions(
      select,
      "0x00000000000000000000000000000000000000a1",
    );
    expect(onSelect).toHaveBeenCalledWith(
      "0x00000000000000000000000000000000000000a1",
    );
  });
});
