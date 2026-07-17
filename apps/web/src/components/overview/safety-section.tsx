import {
  LockIcon,
  ProofIcon,
  UsersIcon,
  type IconProps,
} from "@/components/overview/icons";
import { SectionHeader } from "@/components/ui/section-header";
import type { ComponentType } from "react";

type Guarantee = {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
};

const GUARANTEES: readonly Guarantee[] = [
  {
    icon: LockIcon,
    title: "Non-custodial",
    description:
      "You redeem on the AssetManager yourself, and recovered collateral is paid directly to you by the protocol — not through Harbor.",
  },
  {
    icon: ProofIcon,
    title: "Proof-carrying",
    description:
      "A default executes only against a finalized Flare Data Connector proof of non-payment — not on trust, and not on a guess.",
  },
  {
    icon: UsersIcon,
    title: "Permissionless",
    description:
      "The executor is open to anyone. If Harbor’s keeper is ever offline, you can finish a stuck recovery from this console yourself.",
  },
];

/**
 * "Why it's safe to let Harbor handle it" — the trust argument. Three equally
 * weighted guarantee cards in a row that use the full width on desktop and
 * tablet and stack on phones. Each card pairs a neutral icon with the
 * guarantee it maps to, laid out icon-left so the claim title anchors the
 * reader before the supporting detail.
 */
export function SafetySection() {
  return (
    <section id="safety" className="scroll-mt-24">
      <SectionHeader
        eyebrow="Why it's safe"
        title="Why it’s safe to let Harbor handle it"
        description="Harbor automates the work, but the protocol keeps custody and control."
      />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GUARANTEES.map((guarantee) => {
          const Icon = guarantee.icon;

          return (
            <div
              key={guarantee.title}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              <div className="flex items-start gap-3.5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {guarantee.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                    {guarantee.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
