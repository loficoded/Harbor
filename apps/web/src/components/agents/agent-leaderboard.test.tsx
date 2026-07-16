import { AgentLeaderboard } from "@/components/agents/agent-leaderboard";
import type { HarborApiClient } from "@/lib/api-client";
import { formatAddress } from "@/lib/format";
import {
  AGENT_A,
  AGENT_B,
  AGENT_C,
  agentDetails,
  agentsResponse,
  agentView,
} from "@/test/agents-fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

type GetAgents = HarborApiClient["getAgents"];

/** Stand-in client exposing only the `getAgents` method the hook uses. */
function makeClient(getAgents: GetAgents): HarborApiClient {
  return { getAgents } as unknown as HarborApiClient;
}

function resolvingClient(response: ReturnType<typeof agentsResponse>) {
  return makeClient(vi.fn(async () => response) as unknown as GetAgents);
}

/** Ordered vault suffixes of the desktop table's body rows (top-ranked first). */
async function tableRows(): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table");
  return within(table).getAllByTestId("agent-row");
}

const rankedThree = agentsResponse([
  agentView({
    agentVault: AGENT_A,
    score: 40,
    availableLots: "111",
    averageSettlementSeconds: 300,
  }),
  agentView({
    agentVault: AGENT_B,
    score: 90,
    availableLots: "50",
    averageSettlementSeconds: 900,
  }),
  agentView({
    agentVault: AGENT_C,
    score: 65,
    availableLots: "333",
    averageSettlementSeconds: 120,
  }),
]);

describe("AgentLeaderboard load states", () => {
  it("shows a loading indicator while the request is in flight", () => {
    const client = makeClient(
      vi.fn(() => new Promise(() => {})) as unknown as GetAgents,
    );
    render(<AgentLeaderboard client={client} />);
    expect(screen.getByText("Loading agents…")).toBeInTheDocument();
  });

  it("frames the ranking as a heuristic", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    // Present immediately and after data loads.
    expect(
      screen.getByText(/not a guarantee of settlement/i),
    ).toBeInTheDocument();
    await tableRows();
  });

  it("renders a backend-empty state with no controls", async () => {
    render(<AgentLeaderboard client={resolvingClient(agentsResponse([]))} />);
    expect(await screen.findByText("No ranked agents yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /sort by/i }),
    ).not.toBeInTheDocument();
  });

  it("renders an API error state with a working retry", async () => {
    const getAgents = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce(rankedThree);
    const client = makeClient(getAgents as unknown as GetAgents);

    render(<AgentLeaderboard client={client} />);

    expect(
      await screen.findByText("Could not load agents"),
    ).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(getAgents).toHaveBeenCalledTimes(2);
  });
});

describe("AgentLeaderboard sorting", () => {
  it("defaults to highest score first", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    const rows = await tableRows();
    expect(rows[0]).toHaveTextContent(/00b2/);
    expect(rows[1]).toHaveTextContent(/00c3/);
    expect(rows[2]).toHaveTextContent(/00a1/);
  });

  it("re-orders by most available lots", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    await tableRows();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /sort by/i }),
      "availableLots",
    );

    const rows = await tableRows();
    expect(rows[0]).toHaveTextContent(/00c3/); // 333 lots
    expect(rows[1]).toHaveTextContent(/00a1/); // 111 lots
    expect(rows[2]).toHaveTextContent(/00b2/); // 50 lots
  });

  it("re-orders by fastest average settlement", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    await tableRows();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /sort by/i }),
      "settlement",
    );

    const rows = await tableRows();
    expect(rows[0]).toHaveTextContent(/00c3/); // 120s
    expect(rows[1]).toHaveTextContent(/00a1/); // 300s
    expect(rows[2]).toHaveTextContent(/00b2/); // 900s
  });
});

describe("AgentLeaderboard filtering", () => {
  it("hides unavailable agents when toggled", async () => {
    const response = agentsResponse([
      agentView({ agentVault: AGENT_A, score: 40, availability: "AVAILABLE" }),
      agentView({
        agentVault: AGENT_B,
        score: 90,
        availability: "UNAVAILABLE",
      }),
      agentView({ agentVault: AGENT_C, score: 65, availability: "AVAILABLE" }),
    ]);
    render(<AgentLeaderboard client={resolvingClient(response)} />);
    expect(await tableRows()).toHaveLength(3);

    await userEvent.click(
      screen.getByRole("checkbox", { name: /hide unavailable agents/i }),
    );

    const rows = await tableRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/00c3/);
    expect(rows[1]).toHaveTextContent(/00a1/);
    expect(within(screen.getByRole("table")).queryByText(/00b2/)).toBeNull();
  });

  it("shows a filtered-empty state when nothing matches", async () => {
    const response = agentsResponse([
      agentView({ agentVault: AGENT_B, availability: "UNAVAILABLE" }),
    ]);
    render(<AgentLeaderboard client={resolvingClient(response)} />);
    await tableRows();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /hide unavailable agents/i }),
    );

    expect(
      await screen.findByText("No agents match the current filter"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    // The "show all" affordance restores the full list.
    await userEvent.click(
      screen.getByRole("button", { name: /show all agents/i }),
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("AgentLeaderboard stale FTSO indicator", () => {
  it("flags a stale FTSO-derived collateral ratio", async () => {
    const response = agentsResponse([
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "FTSO_DERIVED",
        collateralRatioBips: "20000",
        ftsoStatus: "STALE",
      }),
    ]);
    render(<AgentLeaderboard client={resolvingClient(response)} />);
    const table = await screen.findByRole("table");

    expect(within(table).getByText("Stale")).toBeInTheDocument();
    expect(within(table).getByText("FTSO-derived")).toBeInTheDocument();
  });

  it("does not flag a fresh inventory-sourced ratio", async () => {
    const response = agentsResponse([
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "INVENTORY",
        collateralRatioBips: "25000",
        ftsoStatus: "AVAILABLE",
      }),
    ]);
    render(<AgentLeaderboard client={resolvingClient(response)} />);
    const table = await screen.findByRole("table");

    expect(within(table).queryByText("Stale")).toBeNull();
    expect(within(table).getByText("On-chain inventory")).toBeInTheDocument();
  });
});

describe("AgentLeaderboard accessibility", () => {
  it("exposes a labelled table with column headers", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    const table = await screen.findByRole("table", {
      name: /agent reliability leaderboard/i,
    });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
  });

  it("exposes labelled sort and filter controls", async () => {
    render(<AgentLeaderboard client={resolvingClient(rankedThree)} />);
    await screen.findByRole("table");
    expect(
      screen.getByRole("combobox", { name: /sort by/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /hide unavailable agents/i }),
    ).toBeInTheDocument();
  });

  it("toggles the availability filter from the keyboard", async () => {
    const response = agentsResponse([
      agentView({ agentVault: AGENT_A, availability: "AVAILABLE" }),
      agentView({ agentVault: AGENT_B, availability: "UNAVAILABLE" }),
    ]);
    render(<AgentLeaderboard client={resolvingClient(response)} />);
    expect(await tableRows()).toHaveLength(2);

    const checkbox = screen.getByRole("checkbox", {
      name: /hide unavailable agents/i,
    });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    await userEvent.keyboard(" ");

    expect(await tableRows()).toHaveLength(1);
  });
});

describe("AgentLeaderboard official agent identity", () => {
  const withOfficialIdentity = agentsResponse([
    agentView({
      agentVault: AGENT_A,
      score: 90,
      details: agentDetails({
        name: "Acme Redeemer",
        iconUrl: "https://example.com/acme.png",
      }),
    }),
    agentView({ agentVault: AGENT_B, score: 40, details: agentDetails() }),
  ]);

  it("shows the official name and icon in the desktop table", async () => {
    render(<AgentLeaderboard client={resolvingClient(withOfficialIdentity)} />);
    const table = await screen.findByRole("table");

    expect(within(table).getByText("Acme Redeemer")).toBeInTheDocument();
    expect(
      within(table).getByRole("img", { name: "Acme Redeemer agent icon" }),
    ).toBeInTheDocument();
  });

  it("falls back to the vault address for an agent without official details", async () => {
    render(<AgentLeaderboard client={resolvingClient(withOfficialIdentity)} />);
    const table = await screen.findByRole("table");

    // The unnamed agent renders its truncated vault address, not an invented
    // name; no icon is shown for it.
    expect(within(table).getByText(formatAddress(AGENT_B))).toBeInTheDocument();
    expect(
      within(table).queryByRole("img", { name: `Agent ${AGENT_B} icon` }),
    ).toBeNull();
  });

  it("shows the official name in the mobile cards too", async () => {
    render(<AgentLeaderboard client={resolvingClient(withOfficialIdentity)} />);
    await screen.findByRole("table");

    const cardList = screen.getByRole("list", {
      name: /agent reliability leaderboard/i,
    });
    expect(within(cardList).getByText("Acme Redeemer")).toBeInTheDocument();
    expect(
      within(cardList).getByText(formatAddress(AGENT_B)),
    ).toBeInTheDocument();
  });
});
