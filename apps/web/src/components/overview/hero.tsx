import { ComparisonCard } from "@/components/overview/comparison-card";
import { FeatureStrip } from "@/components/overview/feature-strip";
import { ArrowDownIcon } from "@/components/overview/icons";
import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";

/**
 * Overview hero. Establishes what Harbor is and why it exists before the reader
 * reaches the console: an eyebrow tag, the headline claim, a one-sentence
 * explanation, and two CTAs, balanced against a comparison card that makes the
 * "manual vs. automatic" contrast concrete. On desktop the copy owns the left
 * seven columns and the comparison card the right five, so the eye lands on the
 * headline first (top-left) and the primary CTA and the card sit along the
 * Z-diagonal. The properties strip closes the card. Both CTAs are in-page
 * anchors, so the section is fully static (no client runtime).
 */
export function Hero() {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="grid grid-cols-1 items-center gap-10 p-6 sm:p-8 lg:grid-cols-12 lg:gap-12 lg:p-10">
        <div className="flex flex-col lg:col-span-7">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            Redeem FXRP for XRP • Flare
          </p>

          <h1 className="mt-4 max-w-[18ch] text-[2.25rem] font-bold leading-[1.05] tracking-tight text-gray-900 sm:text-5xl dark:text-gray-50">
            Redeem FXRP. Harbor handles the rest.
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-600 sm:text-lg dark:text-gray-300">
            Usually, your XRP just arrives. If it ever doesn&rsquo;t, Harbor
            claims the compensation you&rsquo;re owed — for you, automatically.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#redeem"
              className={buttonClasses({
                size: "lg",
                className: "w-full sm:w-auto",
              })}
            >
              Redeem FXRP
              <ArrowDownIcon className="h-4 w-4" />
            </Link>
            <Link
              href="#how"
              className={buttonClasses({
                variant: "secondary",
                size: "lg",
                className: "w-full sm:w-auto",
              })}
            >
              See how it works
            </Link>
          </div>
        </div>

        <div className="lg:col-span-5">
          <ComparisonCard />
        </div>
      </div>

      <FeatureStrip />
    </section>
  );
}
