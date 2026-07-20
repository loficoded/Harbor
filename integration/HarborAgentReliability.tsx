/**
 * HarborAgentReliability — a drop-in React component that renders a live FXRP
 * agent-reliability leaderboard from Harbor's public read API.
 *
 * Zero dependencies beyond React. No API key, no wallet, no custody — it is a
 * read-only GET. Copy this file into your app and render <HarborAgentReliability />.
 *
 * Requires Harbor's API to allow your origin via CORS
 * (HARBOR_API_CORS_ORIGINS=* on the Railway service, or your exact origin).
 */
import { useEffect, useState } from "react";

const DEFAULT_API = "https://api-production-6f3ec.up.railway.app";

type AgentDetails = {
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  termsOfUseUrl: string | null;
};

type Agent = {
  agentVault: string;
  score: number;
  scoreIsHeuristic: boolean;
  successfulRedemptions: number;
  defaultedRedemptions: number;
  averageSettlementSeconds: number | null;
  availability: string;
  availableLots: string;
  collateralRatioBips: string;
  details: AgentDetails;
  updatedAt: string;
};

type AgentsResponse = {
  asset: string;
  scoreIsHeuristic: boolean;
  agents: Agent[];
  generatedAt: string;
};

const short = (v: string) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "");
const secs = (s: number | null) =>
  s == null ? "—" : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`;
const ratio = (bips: string) => {
  const n = Number(bips);
  return Number.isFinite(n) ? `${(n / 100).toFixed(0)}%` : "—";
};

export function HarborAgentReliability({
  apiBaseUrl = DEFAULT_API,
  asset = "FXRP",
  limit,
}: {
  apiBaseUrl?: string;
  asset?: string;
  limit?: number;
}) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = apiBaseUrl.replace(/\/+$/, "");
    fetch(`${base}/agents?asset=${encodeURIComponent(asset)}`, {
      headers: { accept: "application/json" },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [apiBaseUrl, asset]);

  if (error) return <p>Could not load Harbor data ({error}).</p>;
  if (!data) return <p>Loading agent reliability…</p>;

  const agents = [...data.agents]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? data.agents.length);

  return (
    <div>
      <h3>
        {data.asset} Agent Reliability —{" "}
        <a href="https://harbor-web-olive.vercel.app/agents" target="_blank" rel="noopener noreferrer">
          powered by Harbor
        </a>
      </h3>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Heuristic score (0–100), informational only. FAssets assigns agents FIFO.
      </p>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Score</th>
            <th>Settled</th>
            <th>Defaults</th>
            <th>Avg time</th>
            <th>Free lots</th>
            <th>Collateral</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agentVault}>
              <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {a.details.iconUrl ? (
                  <img
                    src={a.details.iconUrl}
                    alt=""
                    width={24}
                    height={24}
                    style={{ borderRadius: "50%" }}
                  />
                ) : null}
                {a.details.name ?? short(a.agentVault)}
              </td>
              <td>{a.score}</td>
              <td>{a.successfulRedemptions}</td>
              <td style={{ color: a.defaultedRedemptions === 0 ? "#059669" : "#d97706" }}>
                {a.defaultedRedemptions}
              </td>
              <td>{secs(a.averageSettlementSeconds)}</td>
              <td>{a.availableLots}</td>
              <td>{ratio(a.collateralRatioBips)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
