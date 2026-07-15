"use client";

import type { AgentDetails } from "@harbor/shared";
import { useState, type ReactElement } from "react";

import {
  agentMonogram,
  officialAgentName,
  resolveAgentIconUrl,
  type MaybeAgentDetails,
} from "@/lib/agents";
import { cn } from "@/lib/cn";
import { formatAddress } from "@/lib/format";

export type AgentIdentityProps = Readonly<{
  /**
   * Official agent details from the `AgentOwnerRegistry`. Accepts a missing
   * value so legacy/partial payloads render the address fallback unchanged.
   */
  details: MaybeAgentDetails;
  /** The agent's vault address, used for the fallback name and monogram. */
  agentVault: string;
  /** Avatar + text scale. */
  size?: "sm" | "md";
  /**
   * Whether to show the vault address beneath the official name (so users can
   * still verify the on-chain identity). Ignored when there is no official
   * name, since the address is then already the primary label.
   */
  showAddress?: boolean;
  className?: string;
}>;

const SIZE_CLASSES: Record<
  NonNullable<AgentIdentityProps["size"]>,
  { avatar: string; name: string }
> = {
  sm: { avatar: "h-7 w-7 text-[0.7rem]", name: "text-sm" },
  md: { avatar: "h-9 w-9 text-sm", name: "text-sm" },
};

/**
 * Canonical rendering of an agent's identity: the official icon and name from
 * the FAssets `AgentOwnerRegistry` when available, falling back to a generated
 * monogram avatar and the truncated vault address otherwise. Shared by the
 * agent leaderboard and the redemption status view so official metadata is
 * presented consistently everywhere agent information appears.
 *
 * The fallback is total and automatic: a missing name shows the address, a
 * missing/invalid icon shows the monogram, and an icon that fails to load at
 * runtime falls back to the monogram too — so incomplete or unavailable
 * metadata never degrades the layout or leaves a broken image.
 */
export function AgentIdentity({
  details,
  agentVault,
  size = "md",
  showAddress = true,
  className,
}: AgentIdentityProps): ReactElement {
  const [iconFailed, setIconFailed] = useState(false);

  const name = officialAgentName(details);
  const hasName = name !== null;
  const displayName = name ?? formatAddress(agentVault);
  const iconUrl = resolveAgentIconUrl(details);
  const showIcon = iconUrl !== null && !iconFailed;
  const monogram = agentMonogram(details, agentVault);
  const sizeClasses = SIZE_CLASSES[size];
  const iconAlt = hasName
    ? `${name} agent icon`
    : `Agent ${agentVault} icon`;

  return (
    <span
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      data-testid="agent-identity"
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          "border border-gray-200 bg-gray-100 font-semibold text-gray-600",
          "dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
          sizeClasses.avatar,
        )}
      >
        {showIcon ? (
          // A plain <img> is intentional: icon URLs are arbitrary,
          // agent-controlled, and cannot be enumerated for next/image's remote
          // patterns. onError falls back to the monogram below.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconUrl}
            alt={iconAlt}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setIconFailed(true)}
            data-testid="agent-identity-icon"
          />
        ) : (
          <span aria-hidden="true" data-testid="agent-identity-monogram">
            {monogram}
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "truncate text-gray-900 dark:text-gray-100",
            hasName ? cn("font-medium", sizeClasses.name) : "font-mono text-xs",
          )}
          title={hasName ? name : agentVault}
          data-testid="agent-identity-name"
        >
          {displayName}
        </span>
        {hasName && showAddress ? (
          <span
            className="truncate font-mono text-xs text-gray-500 dark:text-gray-400"
            title={agentVault}
            data-testid="agent-identity-address"
          >
            {formatAddress(agentVault)}
          </span>
        ) : null}
      </span>
    </span>
  );
}
