import {
  LayersIcon,
  LockIcon,
  UsersIcon,
  type IconProps,
} from "@/components/overview/icons";
import type { ComponentType } from "react";

type Feature = {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
};

const FEATURES: readonly Feature[] = [
  {
    icon: LockIcon,
    title: "Non-custodial",
    description: "Funds go directly to you, not through Harbor.",
  },
  {
    icon: LayersIcon,
    title: "Protocol-native",
    description: "Automation on top of FAssets — not a middleman.",
  },
  {
    icon: UsersIcon,
    title: "Permissionless",
    description: "Anyone can complete a recovery, any time.",
  },
];

/**
 * Quiet reassurance strip anchored to the foot of the hero card. Three evenly
 * weighted properties, each an icon paired with a one-line claim, reinforcing
 * the pitch without competing with the primary CTA above it. Dividers between
 * the columns give it a spec-sheet rhythm on wider panels.
 */
export function FeatureStrip() {
  return (
    <div className="grid grid-cols-1 divide-y divide-gray-200 border-t border-gray-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-gray-800 dark:border-gray-800">
      {FEATURES.map((feature) => {
        const Icon = feature.icon;

        return (
          <div
            key={feature.title}
            className="flex items-start gap-3 px-6 py-4 sm:px-7"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {feature.title}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-gray-500 dark:text-gray-400">
                {feature.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
