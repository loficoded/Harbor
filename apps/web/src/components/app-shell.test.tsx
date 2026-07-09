import { AppShell } from "@/components/app-shell";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// next/navigation and next/link require the App Router runtime context, which
// is not present under jsdom. Replace them with inert test doubles so the shell
// and its navigation render in isolation.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");

  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
    }) => createElement("a", { href, ...rest }, children),
  };
});

describe("AppShell", () => {
  it("renders the brand, primary navigation, and page content", () => {
    render(<AppShell>Console body</AppShell>);

    expect(screen.getByText("Harbor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("Console body")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders the header and banner slots when provided", () => {
    render(
      <AppShell
        headerRight={<span>wallet-slot</span>}
        banner={<span>guard-slot</span>}
      >
        body
      </AppShell>,
    );

    expect(screen.getByText("wallet-slot")).toBeInTheDocument();
    expect(screen.getByText("guard-slot")).toBeInTheDocument();
  });
});
