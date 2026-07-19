"use client";

import { RedemptionFormView } from "@/components/redemption/redemption-form-view";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { formatAddress } from "@/lib/format";
import { formatFxrpAmount } from "@/lib/redemption";
import { useState } from "react";

import {
  HARBOR_REDEEMER_ADDRESS,
  HARNESS_XRPL_DESTINATION,
} from "./harness-data";

type ConsoleVariant = "approve-required" | "submitted" | "with-tag";

const AMOUNT_UBA = 42_500_000n; // 42.5 FXRP
const AMOUNT_LABEL = formatFxrpAmount(AMOUNT_UBA);
const EXECUTOR_FEE_LABEL = "0.1 C2FLR";
const EXECUTOR_LABEL = formatAddress(HARBOR_REDEEMER_ADDRESS);

const VARIANT_CONFIG: Record<
  ConsoleVariant,
  {
    tagInput: string;
    approvalRequired: boolean;
    submittedRequestIds: readonly string[] | null;
    headerTitle: string;
    headerDescription: string;
  }
> = {
  "approve-required": {
    tagInput: "",
    approvalRequired: true,
    submittedRequestIds: null,
    headerTitle: "Redemption console",
    headerDescription:
      "Redeem FXRP for underlying XRP on Flare Coston2 and track settlement to its final outcome.",
  },
  submitted: {
    tagInput: "",
    approvalRequired: false,
    submittedRequestIds: ["38217645"],
    headerTitle: "Redemption console",
    headerDescription:
      "Redeem FXRP for underlying XRP on Flare Coston2 and track settlement to its final outcome.",
  },
  "with-tag": {
    tagInput: "314159",
    approvalRequired: false,
    submittedRequestIds: null,
    headerTitle: "Redemption console · destination tag",
    headerDescription:
      "Redeem-by-tag lane: the agent's XRPL payment must carry the exact destination tag to settle.",
  },
};

export function RedemptionConsoleHarness({
  variant,
}: {
  variant: ConsoleVariant;
}) {
  const config = VARIANT_CONFIG[variant];
  const [amountInput, setAmountInput] = useState("42.5");
  const [addressInput, setAddressInput] = useState(HARNESS_XRPL_DESTINATION);
  const [tagInput, setTagInput] = useState(config.tagInput);

  return (
    <div>
      <PageHeader
        eyebrow="Console"
        title={config.headerTitle}
        description={config.headerDescription}
      />

      <Card padding="lg">
        <CardHeader
          title="Redeem FXRP"
          description="Burn FXRP to receive XRP at your destination address. Approve the AssetManager, then submit the redemption."
        />
        <RedemptionFormView
          isConnected
          correctNetwork
          balanceLabel="128.5"
          balanceLoading={false}
          amountInput={amountInput}
          onAmountInputChange={setAmountInput}
          amountError={null}
          amountLabel={AMOUNT_LABEL}
          addressInput={addressInput}
          onAddressChange={setAddressInput}
          addressError={null}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          tagError={null}
          tagSupported
          executorFeeLabel={EXECUTOR_FEE_LABEL}
          executorLabel={EXECUTOR_LABEL}
          harborManaged
          approvalRequired={config.approvalRequired}
          approvalPending={false}
          redeemPending={false}
          blockedReason={null}
          errorMessage={null}
          submittedRequestIds={config.submittedRequestIds}
          onApprove={() => undefined}
          onRedeem={() => undefined}
        />
      </Card>
    </div>
  );
}
