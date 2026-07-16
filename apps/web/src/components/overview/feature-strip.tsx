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
 * the pitch without competing with the primary CTA above it.
 */
export function FeatureStrip() {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-gray-200 px-6 py-4 sm:grid-cols-3 sm:px-8 dark:border-gray-800">
      {FEATURES.map((feature) => {
        const Icon = feature.icon;

        return (
          <div key={feature.title} className="flex items-start gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
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
