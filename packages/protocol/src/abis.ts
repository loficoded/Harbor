import type { Abi, AbiParameter } from "./types.js";
import { harborRedeemerAbi } from "./harborRedeemerArtifact.js";

const address = (name: string, internalType = "address"): AbiParameter => ({
  name,
  internalType,
  type: "address",
});

const uint = (name: string, internalType = "uint256"): AbiParameter => ({
  name,
  internalType,
  type: internalType,
});

const bool = (name: string): AbiParameter => ({
  name,
  internalType: "bool",
  type: "bool",
});

const bytes32 = (name: string): AbiParameter => ({
  name,
  internalType: "bytes32",
  type: "bytes32",
});

const settingsComponents = [
  address("assetManagerController"),
  address("fAsset"),
  address("agentVaultFactory"),
  address("collateralPoolFactory"),
  address("collateralPoolTokenFactory"),
  { name: "poolTokenSuffix", internalType: "string", type: "string" },
  address("__whitelist"),
  address("agentOwnerRegistry"),
  address("fdcVerification"),
  address("burnAddress", "address payable"),
  address("priceReader"),
  { name: "assetDecimals", internalType: "uint8", type: "uint8" },
  { name: "assetMintingDecimals", internalType: "uint8", type: "uint8" },
  bytes32("chainId"),
  { name: "averageBlockTimeMS", internalType: "uint32", type: "uint32" },
  {
    name: "mintingPoolHoldingsRequiredBIPS",
    internalType: "uint32",
    type: "uint32",
  },
  {
    name: "collateralReservationFeeBIPS",
    internalType: "uint16",
    type: "uint16",
  },
  { name: "assetUnitUBA", internalType: "uint64", type: "uint64" },
  {
    name: "assetMintingGranularityUBA",
    internalType: "uint64",
    type: "uint64",
  },
  { name: "lotSizeAMG", internalType: "uint64", type: "uint64" },
  {
    name: "__minUnderlyingBackingBIPS",
    internalType: "uint16",
    type: "uint16",
  },
  {
    name: "__requireEOAAddressProof",
    internalType: "bool",
    type: "bool",
  },
  { name: "mintingCapAMG", internalType: "uint64", type: "uint64" },
  {
    name: "underlyingBlocksForPayment",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "underlyingSecondsForPayment",
    internalType: "uint64",
    type: "uint64",
  },
  { name: "redemptionFeeBIPS", internalType: "uint16", type: "uint16" },
  {
    name: "redemptionDefaultFactorVaultCollateralBIPS",
    internalType: "uint32",
    type: "uint32",
  },
  {
    name: "__redemptionDefaultFactorPoolBIPS",
    internalType: "uint32",
    type: "uint32",
  },
  {
    name: "confirmationByOthersAfterSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "confirmationByOthersRewardUSD5",
    internalType: "uint128",
    type: "uint128",
  },
  { name: "maxRedeemedTickets", internalType: "uint16", type: "uint16" },
  {
    name: "paymentChallengeRewardBIPS",
    internalType: "uint16",
    type: "uint16",
  },
  {
    name: "paymentChallengeRewardUSD5",
    internalType: "uint128",
    type: "uint128",
  },
  {
    name: "withdrawalWaitMinSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "maxTrustedPriceAgeSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  { name: "__ccbTimeSeconds", internalType: "uint64", type: "uint64" },
  {
    name: "attestationWindowSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "minUpdateRepeatTimeSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__buybackCollateralFactorBIPS",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__announcedUnderlyingConfirmationMinSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__tokenInvalidationTimeMinSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "vaultCollateralBuyForFlareFactorBIPS",
    internalType: "uint32",
    type: "uint32",
  },
  {
    name: "agentExitAvailableTimelockSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "agentFeeChangeTimelockSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "agentMintingCRChangeTimelockSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "poolExitCRChangeTimelockSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "agentTimelockedOperationWindowSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "collateralPoolTokenTimelockSeconds",
    internalType: "uint32",
    type: "uint32",
  },
  { name: "liquidationStepSeconds", internalType: "uint64", type: "uint64" },
  {
    name: "liquidationCollateralFactorBIPS",
    internalType: "uint256[]",
    type: "uint256[]",
  },
  {
    name: "liquidationFactorVaultCollateralBIPS",
    internalType: "uint256[]",
    type: "uint256[]",
  },
  {
    name: "diamondCutMinTimelockSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "maxEmergencyPauseDurationSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "emergencyPauseDurationResetAfterSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__cancelCollateralReservationAfterSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__rejectOrCancelCollateralReservationReturnFactorBIPS",
    internalType: "uint16",
    type: "uint16",
  },
  {
    name: "__rejectRedemptionRequestWindowSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__takeOverRedemptionRequestWindowSeconds",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "__rejectedRedemptionDefaultFactorVaultCollateralBIPS",
    internalType: "uint32",
    type: "uint32",
  },
  {
    name: "__rejectedRedemptionDefaultFactorPoolBIPS",
    internalType: "uint32",
    type: "uint32",
  },
] as const satisfies readonly AbiParameter[];

const agentInfoComponents = [
  { name: "status", internalType: "enum AgentInfo.Status", type: "uint8" },
  address("ownerManagementAddress"),
  address("ownerWorkAddress"),
  address("collateralPool"),
  address("collateralPoolToken"),
  {
    name: "underlyingAddressString",
    internalType: "string",
    type: "string",
  },
  { name: "publiclyAvailable", internalType: "bool", type: "bool" },
  uint("feeBIPS"),
  uint("poolFeeShareBIPS"),
  address("vaultCollateralToken", "contract IERC20"),
  uint("mintingVaultCollateralRatioBIPS"),
  uint("mintingPoolCollateralRatioBIPS"),
  uint("freeCollateralLots"),
  uint("totalVaultCollateralWei"),
  uint("freeVaultCollateralWei"),
  uint("vaultCollateralRatioBIPS"),
  address("poolWNatToken", "contract IERC20"),
  uint("totalPoolCollateralNATWei"),
  uint("freePoolCollateralNATWei"),
  uint("poolCollateralRatioBIPS"),
  uint("totalAgentPoolTokensWei"),
  uint("announcedVaultCollateralWithdrawalWei"),
  uint("announcedPoolTokensWithdrawalWei"),
  uint("freeAgentPoolTokensWei"),
  uint("mintedUBA"),
  uint("reservedUBA"),
  uint("redeemingUBA"),
  uint("poolRedeemingUBA"),
  uint("dustUBA"),
  uint("liquidationStartTimestamp"),
  uint("maxLiquidationAmountUBA"),
  uint("liquidationPaymentFactorVaultBIPS"),
  uint("liquidationPaymentFactorPoolBIPS"),
  { name: "underlyingBalanceUBA", internalType: "int256", type: "int256" },
  uint("requiredUnderlyingBalanceUBA"),
  { name: "freeUnderlyingBalanceUBA", internalType: "int256", type: "int256" },
  uint("announcedUnderlyingWithdrawalId"),
  uint("buyFAssetByAgentFactorBIPS"),
  uint("poolExitCollateralRatioBIPS"),
  uint("redemptionPoolFeeShareBIPS"),
] as const satisfies readonly AbiParameter[];

const availableAgentComponents = [
  address("agentVault"),
  address("ownerManagementAddress"),
  uint("feeBIPS"),
  uint("mintingVaultCollateralRatioBIPS"),
  uint("mintingPoolCollateralRatioBIPS"),
  uint("freeCollateralLots"),
  { name: "status", internalType: "enum AgentInfo.Status", type: "uint8" },
] as const satisfies readonly AbiParameter[];

export const referencedPaymentNonexistenceRequestBodyAbi = [
  {
    name: "minimalBlockNumber",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "deadlineBlockNumber",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "deadlineTimestamp",
    internalType: "uint64",
    type: "uint64",
  },
  bytes32("destinationAddressHash"),
  uint("amount"),
  bytes32("standardPaymentReference"),
  {
    name: "checkSourceAddresses",
    internalType: "bool",
    type: "bool",
  },
  bytes32("sourceAddressesRoot"),
] as const satisfies readonly AbiParameter[];

export const referencedPaymentNonexistenceResponseBodyAbi = [
  {
    name: "minimalBlockTimestamp",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "firstOverflowBlockNumber",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "firstOverflowBlockTimestamp",
    internalType: "uint64",
    type: "uint64",
  },
] as const satisfies readonly AbiParameter[];

export const referencedPaymentNonexistenceResponseAbi = [
  bytes32("attestationType"),
  bytes32("sourceId"),
  { name: "votingRound", internalType: "uint64", type: "uint64" },
  {
    name: "lowestUsedTimestamp",
    internalType: "uint64",
    type: "uint64",
  },
  {
    name: "requestBody",
    internalType: "struct IReferencedPaymentNonexistence.RequestBody",
    type: "tuple",
    components: referencedPaymentNonexistenceRequestBodyAbi,
  },
  {
    name: "responseBody",
    internalType: "struct IReferencedPaymentNonexistence.ResponseBody",
    type: "tuple",
    components: referencedPaymentNonexistenceResponseBodyAbi,
  },
] as const satisfies readonly AbiParameter[];

export const referencedPaymentNonexistenceProofAbi = [
  { name: "merkleProof", internalType: "bytes32[]", type: "bytes32[]" },
  {
    name: "data",
    internalType: "struct IReferencedPaymentNonexistence.Response",
    type: "tuple",
    components: referencedPaymentNonexistenceResponseAbi,
  },
] as const satisfies readonly AbiParameter[];

const referencedPaymentNonexistenceProof = {
  name: "_proof",
  internalType: "struct IReferencedPaymentNonexistence.Proof",
  type: "tuple",
  components: referencedPaymentNonexistenceProofAbi,
} as const satisfies AbiParameter;

// ---------------------------------------------------------------------------
// XRPPaymentNonexistence — the FDC default proof for redeem-by-tag.
// Mirrors `IXRPPaymentNonexistence` (coston2 periphery, attestation id 0x09).
// ---------------------------------------------------------------------------

export const xrpPaymentNonexistenceRequestBodyAbi = [
  { name: "minimalBlockNumber", internalType: "uint64", type: "uint64" },
  { name: "deadlineBlockNumber", internalType: "uint64", type: "uint64" },
  { name: "deadlineTimestamp", internalType: "uint64", type: "uint64" },
  bytes32("destinationAddressHash"),
  uint("amount"),
  bool("checkFirstMemoData"),
  bytes32("firstMemoDataHash"),
  bool("checkDestinationTag"),
  uint("destinationTag"),
  address("proofOwner"),
] as const satisfies readonly AbiParameter[];

export const xrpPaymentNonexistenceResponseBodyAbi = [
  { name: "minimalBlockTimestamp", internalType: "uint64", type: "uint64" },
  { name: "firstOverflowBlockNumber", internalType: "uint64", type: "uint64" },
  {
    name: "firstOverflowBlockTimestamp",
    internalType: "uint64",
    type: "uint64",
  },
] as const satisfies readonly AbiParameter[];

export const xrpPaymentNonexistenceResponseAbi = [
  bytes32("attestationType"),
  bytes32("sourceId"),
  { name: "votingRound", internalType: "uint64", type: "uint64" },
  { name: "lowestUsedTimestamp", internalType: "uint64", type: "uint64" },
  {
    name: "requestBody",
    internalType: "struct IXRPPaymentNonexistence.RequestBody",
    type: "tuple",
    components: xrpPaymentNonexistenceRequestBodyAbi,
  },
  {
    name: "responseBody",
    internalType: "struct IXRPPaymentNonexistence.ResponseBody",
    type: "tuple",
    components: xrpPaymentNonexistenceResponseBodyAbi,
  },
] as const satisfies readonly AbiParameter[];

export const xrpPaymentNonexistenceProofAbi = [
  { name: "merkleProof", internalType: "bytes32[]", type: "bytes32[]" },
  {
    name: "data",
    internalType: "struct IXRPPaymentNonexistence.Response",
    type: "tuple",
    components: xrpPaymentNonexistenceResponseAbi,
  },
] as const satisfies readonly AbiParameter[];

const xrpPaymentNonexistenceProof = {
  name: "_proof",
  internalType: "struct IXRPPaymentNonexistence.Proof",
  type: "tuple",
  components: xrpPaymentNonexistenceProofAbi,
} as const satisfies AbiParameter;

// ---------------------------------------------------------------------------
// XRPPayment — the FDC confirm proof for redeem-by-tag (attestation id 0x08).
// Exposed for observation/verification; Harbor does not call
// `confirmXRPRedemptionPayment` itself (that is the agent's action), but the
// ABI must be available so clients can decode/verify an XRP payment proof.
// ---------------------------------------------------------------------------

export const xrpPaymentRequestBodyAbi = [
  bytes32("transactionId"),
  address("proofOwner"),
] as const satisfies readonly AbiParameter[];

export const xrpPaymentResponseBodyAbi = [
  { name: "blockNumber", internalType: "uint64", type: "uint64" },
  { name: "blockTimestamp", internalType: "uint64", type: "uint64" },
  { name: "sourceAddress", internalType: "string", type: "string" },
  bytes32("sourceAddressHash"),
  bytes32("receivingAddressHash"),
  bytes32("intendedReceivingAddressHash"),
  { name: "spentAmount", internalType: "int256", type: "int256" },
  { name: "intendedSpentAmount", internalType: "int256", type: "int256" },
  { name: "receivedAmount", internalType: "int256", type: "int256" },
  { name: "intendedReceivedAmount", internalType: "int256", type: "int256" },
  bool("hasMemoData"),
  { name: "firstMemoData", internalType: "bytes", type: "bytes" },
  bool("hasDestinationTag"),
  uint("destinationTag"),
  { name: "status", internalType: "uint8", type: "uint8" },
] as const satisfies readonly AbiParameter[];

export const xrpPaymentResponseAbi = [
  bytes32("attestationType"),
  bytes32("sourceId"),
  { name: "votingRound", internalType: "uint64", type: "uint64" },
  { name: "lowestUsedTimestamp", internalType: "uint64", type: "uint64" },
  {
    name: "requestBody",
    internalType: "struct IXRPPayment.RequestBody",
    type: "tuple",
    components: xrpPaymentRequestBodyAbi,
  },
  {
    name: "responseBody",
    internalType: "struct IXRPPayment.ResponseBody",
    type: "tuple",
    components: xrpPaymentResponseBodyAbi,
  },
] as const satisfies readonly AbiParameter[];

export const xrpPaymentProofAbi = [
  { name: "merkleProof", internalType: "bytes32[]", type: "bytes32[]" },
  {
    name: "data",
    internalType: "struct IXRPPayment.Response",
    type: "tuple",
    components: xrpPaymentResponseAbi,
  },
] as const satisfies readonly AbiParameter[];

export const assetManagerEventsAbi = [
  {
    type: "event",
    anonymous: false,
    name: "RedemptionRequested",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      {
        name: "paymentAddress",
        internalType: "string",
        type: "string",
        indexed: false,
      },
      { ...uint("valueUBA"), indexed: false },
      { ...uint("feeUBA"), indexed: false },
      { ...uint("firstUnderlyingBlock"), indexed: false },
      { ...uint("lastUnderlyingBlock"), indexed: false },
      { ...uint("lastUnderlyingTimestamp"), indexed: false },
      { ...bytes32("paymentReference"), indexed: false },
      { ...address("executor"), indexed: false },
      { ...uint("executorFeeNatWei"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionWithTagRequested",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      {
        name: "paymentAddress",
        internalType: "string",
        type: "string",
        indexed: false,
      },
      { ...uint("valueUBA"), indexed: false },
      { ...uint("feeUBA"), indexed: false },
      { ...uint("firstUnderlyingBlock"), indexed: false },
      { ...uint("lastUnderlyingBlock"), indexed: false },
      { ...uint("lastUnderlyingTimestamp"), indexed: false },
      { ...bytes32("paymentReference"), indexed: false },
      { ...address("executor"), indexed: false },
      { ...uint("executorFeeNatWei"), indexed: false },
      { ...uint("destinationTag"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionRejected",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      { ...uint("redemptionAmountUBA"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionRequestIncomplete",
    inputs: [
      { ...address("redeemer"), indexed: true },
      { ...uint("remainingLots"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionAmountIncomplete",
    inputs: [
      { ...address("redeemer"), indexed: true },
      { ...uint("remainingAmountUBA"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionPerformed",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      { ...bytes32("transactionHash"), indexed: false },
      { ...uint("redemptionAmountUBA"), indexed: false },
      {
        name: "spentUnderlyingUBA",
        internalType: "int256",
        type: "int256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionDefault",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      { ...uint("redemptionAmountUBA"), indexed: false },
      { ...uint("redeemedVaultCollateralWei"), indexed: false },
      { ...uint("redeemedPoolCollateralWei"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionPaymentBlocked",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      { ...bytes32("transactionHash"), indexed: false },
      { ...uint("redemptionAmountUBA"), indexed: false },
      {
        name: "spentUnderlyingUBA",
        internalType: "int256",
        type: "int256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionPaymentFailed",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...address("redeemer"), indexed: true },
      { ...uint("requestId"), indexed: true },
      { ...bytes32("transactionHash"), indexed: false },
      {
        name: "spentUnderlyingUBA",
        internalType: "int256",
        type: "int256",
        indexed: false,
      },
      {
        name: "failureReason",
        internalType: "string",
        type: "string",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionTicketCreated",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...uint("redemptionTicketId"), indexed: true },
      { ...uint("ticketValueUBA"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionTicketUpdated",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...uint("redemptionTicketId"), indexed: true },
      { ...uint("ticketValueUBA"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "RedemptionTicketDeleted",
    inputs: [
      { ...address("agentVault"), indexed: true },
      { ...uint("redemptionTicketId"), indexed: true },
    ],
  },
] as const satisfies Abi;

export const assetManagerAbi = [
  {
    type: "function",
    name: "fAsset",
    inputs: [],
    outputs: [address("", "contract IERC20")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSettings",
    inputs: [],
    outputs: [
      {
        name: "",
        internalType: "struct AssetManagerSettings.Data",
        type: "tuple",
        components: settingsComponents,
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAllAgents",
    inputs: [uint("_start"), uint("_end")],
    outputs: [
      { name: "_agents", internalType: "address[]", type: "address[]" },
      uint("_totalLength"),
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAvailableAgentsList",
    inputs: [uint("_start"), uint("_end")],
    outputs: [
      { name: "_agents", internalType: "address[]", type: "address[]" },
      uint("_totalLength"),
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAvailableAgentsDetailedList",
    inputs: [uint("_start"), uint("_end")],
    outputs: [
      {
        name: "_agents",
        internalType: "struct AvailableAgentInfo.Data[]",
        type: "tuple[]",
        components: availableAgentComponents,
      },
      uint("_totalLength"),
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentInfo",
    inputs: [address("_agentVault")],
    outputs: [
      {
        name: "",
        internalType: "struct AgentInfo.Info",
        type: "tuple",
        components: agentInfoComponents,
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentSetting",
    inputs: [
      address("_agentVault"),
      { name: "_name", internalType: "string", type: "string" },
    ],
    outputs: [uint("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentVaultOwner",
    inputs: [address("_agentVault")],
    outputs: [address("_ownerManagementAddress")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentVaultCollateralToken",
    inputs: [address("_agentVault")],
    outputs: [address("", "contract IERC20")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentFullVaultCollateral",
    inputs: [address("_agentVault")],
    outputs: [uint("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentFullPoolCollateral",
    inputs: [address("_agentVault")],
    outputs: [uint("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [
      uint("_lots"),
      {
        name: "_redeemerUnderlyingAddressString",
        internalType: "string",
        type: "string",
      },
      address("_executor", "address payable"),
    ],
    outputs: [uint("_redeemedAmountUBA")],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "redeemAmount",
    inputs: [
      uint("_amountUBA"),
      {
        name: "_redeemerUnderlyingAddressString",
        internalType: "string",
        type: "string",
      },
      address("_executor", "address payable"),
    ],
    outputs: [uint("_redeemedAmountUBA")],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "redemptionPaymentDefault",
    inputs: [referencedPaymentNonexistenceProof, uint("_redemptionRequestId")],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeemWithTag",
    inputs: [
      uint("_amountUBA"),
      {
        name: "_redeemerUnderlyingAddressString",
        internalType: "string",
        type: "string",
      },
      address("_executor", "address payable"),
      uint("_destinationTag"),
    ],
    outputs: [uint("_redeemedAmountUBA")],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "confirmXRPRedemptionPayment",
    inputs: [
      {
        name: "_payment",
        type: "tuple",
        internalType: "struct IXRPPayment.Proof",
        components: xrpPaymentProofAbi,
      },
      uint("_redemptionRequestId"),
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "xrpRedemptionPaymentDefault",
    inputs: [xrpPaymentNonexistenceProof, uint("_redemptionRequestId")],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeemWithTagSupported",
    inputs: [],
    outputs: [bool("")],
    stateMutability: "view",
  },
  ...assetManagerEventsAbi,
] as const satisfies Abi;

export const fAssetAbi = [
  {
    type: "event",
    anonymous: false,
    name: "Approval",
    inputs: [
      { ...address("owner"), indexed: true },
      { ...address("spender"), indexed: true },
      { ...uint("value"), indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "Transfer",
    inputs: [
      { ...address("from"), indexed: true },
      { ...address("to"), indexed: true },
      { ...uint("value"), indexed: false },
    ],
  },
  {
    type: "function",
    name: "allowance",
    inputs: [address("owner"), address("spender")],
    outputs: [uint("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [address("spender"), uint("amount")],
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [address("account")],
    outputs: [uint("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", internalType: "uint8", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const fdcHubAbi = [
  {
    type: "event",
    anonymous: false,
    name: "AttestationRequest",
    inputs: [
      { name: "data", internalType: "bytes", type: "bytes", indexed: false },
      { ...uint("fee"), indexed: false },
    ],
  },
  {
    type: "function",
    name: "requestAttestation",
    inputs: [{ name: "_data", internalType: "bytes", type: "bytes" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "requestsOffsetSeconds",
    inputs: [],
    outputs: [{ name: "", internalType: "uint8", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fdcRequestFeeConfigurations",
    inputs: [],
    outputs: [
      {
        name: "",
        internalType: "contract IFdcRequestFeeConfigurations",
        type: "address",
      },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const fdcRequestFeeConfigurationsAbi = [
  {
    type: "function",
    name: "getRequestFee",
    inputs: [{ name: "_data", internalType: "bytes", type: "bytes" }],
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const ftsoV2Abi = [
  {
    type: "function",
    name: "getFeedById",
    inputs: [{ name: "_feedId", internalType: "bytes21", type: "bytes21" }],
    outputs: [
      { name: "_value", internalType: "uint256", type: "uint256" },
      { name: "_decimals", internalType: "int8", type: "int8" },
      { name: "_timestamp", internalType: "uint64", type: "uint64" },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "getFeedsById",
    inputs: [
      { name: "_feedIds", internalType: "bytes21[]", type: "bytes21[]" },
    ],
    outputs: [
      { name: "_values", internalType: "uint256[]", type: "uint256[]" },
      { name: "_decimals", internalType: "int8[]", type: "int8[]" },
      { name: "_timestamp", internalType: "uint64", type: "uint64" },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "calculateFeeById",
    inputs: [{ name: "_feedId", internalType: "bytes21", type: "bytes21" }],
    outputs: [{ name: "_fee", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "calculateFeeByIds",
    inputs: [
      { name: "_feedIds", internalType: "bytes21[]", type: "bytes21[]" },
    ],
    outputs: [{ name: "_fee", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFtsoProtocolId",
    inputs: [],
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSupportedFeedIds",
    inputs: [],
    outputs: [
      { name: "_feedIds", internalType: "bytes21[]", type: "bytes21[]" },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const relayAbi = [
  {
    type: "event",
    anonymous: false,
    name: "ProtocolMessageRelayed",
    inputs: [
      {
        name: "protocolId",
        internalType: "uint8",
        type: "uint8",
        indexed: true,
      },
      {
        name: "votingRoundId",
        internalType: "uint32",
        type: "uint32",
        indexed: true,
      },
      {
        name: "isSecureRandom",
        internalType: "bool",
        type: "bool",
        indexed: false,
      },
      { ...bytes32("merkleRoot"), indexed: false },
    ],
  },
  {
    type: "function",
    name: "isFinalized",
    inputs: [uint("_protocolId"), uint("_votingRoundId")],
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "merkleRoots",
    inputs: [uint("_protocolId"), uint("_votingRoundId")],
    outputs: [bytes32("_merkleRoot")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getVotingRoundId",
    inputs: [uint("_timestamp")],
    outputs: [uint("_votingRoundId")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFeeInWei",
    inputs: [uint("_protocolId")],
    outputs: [uint("")],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const flareContractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    inputs: [{ name: "_name", internalType: "string", type: "string" }],
    outputs: [address("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getContractAddressByHash",
    inputs: [bytes32("_nameHash")],
    outputs: [address("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAllContracts",
    inputs: [],
    outputs: [
      { name: "_names", internalType: "string[]", type: "string[]" },
      { name: "_addresses", internalType: "address[]", type: "address[]" },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;

/**
 * `IAgentOwnerRegistry` — the FAssets registry that stores official agent
 * owner metadata (name, description, icon, terms of use) keyed by an agent
 * owner's management address, plus the management/work address mapping.
 *
 * Sourced from the official Flare FAssets specification:
 *   - https://dev.flare.network/fassets/developer-guides/fassets-agent-details
 *   - https://dev.flare.network/fassets/reference/IAgentOwnerRegistry
 *
 * The registry's own address is not hard-coded; it is read at runtime from
 * `AssetManager.getSettings().agentOwnerRegistry` (see `settingsComponents`).
 */
export const agentOwnerRegistryAbi = [
  {
    type: "function",
    name: "getAgentName",
    inputs: [address("_managementAddress")],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentDescription",
    inputs: [address("_managementAddress")],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentIconUrl",
    inputs: [address("_managementAddress")],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentTermsOfUseUrl",
    inputs: [address("_managementAddress")],
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getWorkAddress",
    inputs: [address("_managementAddress")],
    outputs: [address("")],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getManagementAddress",
    inputs: [address("_workAddress")],
    outputs: [address("")],
    stateMutability: "view",
  },
] as const satisfies Abi;

export {
  harborRedeemerAbi,
  harborRedeemerArtifactContractName,
  harborRedeemerArtifactPath,
} from "./harborRedeemerArtifact.js";

export const iAssetManagerAbi = assetManagerAbi;
export const iAssetManagerEventsAbi = assetManagerEventsAbi;
export const iFAssetAbi = fAssetAbi;
export const iFdcHubAbi = fdcHubAbi;
export const ftsoV2InterfaceAbi = ftsoV2Abi;
export const iRelayAbi = relayAbi;
export const iFlareContractRegistryAbi = flareContractRegistryAbi;
export const iAgentOwnerRegistryAbi = agentOwnerRegistryAbi;
export const harborContractAbi = harborRedeemerAbi;
