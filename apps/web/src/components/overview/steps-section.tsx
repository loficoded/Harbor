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
 * scannable steps rendered as a horizontal process timeline. A hairline
 * connector runs behind the step markers on desktop and tablet so the
 * 01 → 03 sequence reads left to right across the full width; on phones the
 * markers stack into a single vertical thread instead of shrinking the row.
 */
export function StepsSection() {
  return (
    <section id="how" className="scroll-mt-24">
      <SectionHeader
        eyebrow="How it works"
        title="How Harbor handles the rest"
        description="Everything after you redeem, step by step. You only ever interact with the FAssets protocol — Harbor automates the watching and the recovery around it."
      />

      <ol className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-3">
        {STEPS.map((step) => {
          const Icon = step.icon;

          return (
            <li key={step.number} className="relative flex flex-col">
              {/* Marker row with a connector that reaches to the next step. */}
              <div className="relative flex items-center">
                <span className="relative z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/20">
                  <Icon className="h-5 w-5" />
                </span>
                <span
                  aria-hidden="true"
                  className="ml-4 hidden h-px flex-1 bg-gradient-to-r from-gray-300 to-transparent sm:block dark:from-gray-700"
                />
                <span className="ml-auto pl-4 font-mono text-sm tabular-nums text-gray-300 sm:absolute sm:right-0 sm:top-0 dark:text-gray-600">
                  {step.number}
                </span>
              </div>

              <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
