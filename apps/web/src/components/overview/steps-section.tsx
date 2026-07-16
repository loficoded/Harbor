import {
  EyeIcon,
  RedeemIcon,
  ShieldCheckIcon,
  type IconProps,
} from "@/components/overview/icons";
import { SectionHeader } from "@/components/ui/section-header";
import type { ComponentType } from "react";

type Step = {
  number: string;
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
};

const STEPS: readonly Step[] = [
  {
    number: "01",
    icon: RedeemIcon,
    title: "You redeem directly",
    description:
      "Burn FXRP on the FAssets AssetManager and nominate Harbor’s on-chain executor. You transact with the protocol yourself — Harbor holds none of your FXRP or XRP.",
  },
  {
    number: "02",
    icon: EyeIcon,
    title: "Harbor watches settlement",
    description:
      "A keeper follows your request end to end and confirms the agent’s payment straight from the XRP Ledger, the moment it lands.",
  },
  {
    number: "03",
    icon: ShieldCheckIcon,
    title: "Recovery runs automatically",
    description:
      "If the window closes unpaid, Harbor submits a Flare Data Connector proof of non-payment and triggers the on-chain default, returning your collateral.",
  },
];

/**
 * "How Harbor handles the rest" — the automated pipeline as three ordered,
 * scannable steps. Each card leads with a tinted icon and a muted step number
 * so the eye reads the sequence 01 → 03 top to bottom on mobile, left to right
 * on wider panels.
 */
export function StepsSection() {
  return (
    <section id="how" className="scroll-mt-8">
      <SectionHeader
        title="How Harbor handles the rest"
        description="Everything after you redeem, step by step. You only ever interact with the FAssets protocol — Harbor automates the watching and the recovery around it."
      />

      <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((step) => {
          const Icon = step.icon;

          return (
            <li
              key={step.number}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-start justify-between">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="font-mono text-xs tabular-nums text-gray-300 dark:text-gray-600">
                  {step.number}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {step.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
