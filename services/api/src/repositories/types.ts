import type {
  AgentAvailability,
  AgentRecord,
  AgentScore,
  Bytes32,
  EvmAddress,
  FdcProofRecord,
  FdcRequestRecord,
  FdcRequestStatus,
  HexString,
  IsoTimestamp,
  RedemptionRequest,
  RedemptionRequestId,
  RedemptionStatus,
  TransactionHash,
  XrplAddress,
  XrplPaymentObservation,
} from "@harbor/shared";

export type RedemptionKey = Readonly<{
  assetManagerAddress: EvmAddress;
  requestId: RedemptionRequestId;
}>;

export type StoredRedemptionRequest = RedemptionRequest &
  Readonly<{
    assetManagerAddress: EvmAddress;
    sourceChainId: string;
    sourceBlockNumber: string | null;
    sourceLogIndex: string | null;
    sourceTransactionHash: TransactionHash | null;
    defaultTransactionHash: TransactionHash | null;
    statusReason: string | null;
  }>;

export type UpsertRedemptionInput = RedemptionKey &
  Readonly<{
    sourceChainId: string;
    sourceBlockNumber?: string | null;
    sourceLogIndex?: string | null;
    sourceTransactionHash?: TransactionHash | null;
    transactionHash?: TransactionHash | null;
    redeemer: EvmAddress;
    agentVault: EvmAddress;
    paymentAddress: XrplAddress;
    valueUBA: bigint;
    feeUBA: bigint;
    paymentReference: Bytes32;
    firstUnderlyingBlock: bigint;
    lastUnderlyingBlock: bigint;
    lastUnderlyingTimestamp: bigint;
    executor?: EvmAddress | null;
    executorFeeNatWei: bigint;
    status?: RedemptionStatus;
    defaultTransactionHash?: TransactionHash | null;
    statusReason?: string | null;
    createdAt?: IsoTimestamp;
    updatedAt?: IsoTimestamp;
  }>;

export type UpdateRedemptionStatusInput = RedemptionKey &
  Readonly<{
    status: RedemptionStatus;
    transactionHash?: TransactionHash | null;
    defaultTransactionHash?: TransactionHash | null;
    statusReason?: string | null;
    updatedAt?: IsoTimestamp;
  }>;

export type RedemptionEventRecord = Readonly<{
  chainId: string;
  contractAddress: EvmAddress;
  blockNumber: string;
  logIndex: string;
  transactionHash: TransactionHash;
  transactionIndex: string | null;
  eventName: string;
  assetManagerAddress: EvmAddress | null;
  requestId: RedemptionRequestId | null;
  agentVault: EvmAddress | null;
  redeemer: EvmAddress | null;
  payload: unknown;
  observedAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}>;

export type InsertRedemptionEventInput = Omit<
  RedemptionEventRecord,
  "createdAt"
> &
  Readonly<{
    createdAt?: IsoTimestamp;
  }>;

export type StoredAgentRecord = AgentRecord &
  Readonly<{
    feeFieldsJson: string | null;
    collateralMetadataJson: string | null;
    rawInventoryJson: string | null;
    lastInventoryRefreshAt: IsoTimestamp | null;
  }>;

export type UpsertAgentInput = Readonly<{
  agentVault: EvmAddress;
  owner?: EvmAddress | null;
  paymentAddress?: XrplAddress | null;
  availability?: AgentAvailability;
  redemptionFeeBips?: number | null;
  availableLots?: bigint;
  score?: Partial<AgentScore>;
  feeFieldsJson?: string | null;
  collateralMetadataJson?: string | null;
  rawInventoryJson?: string | null;
  lastInventoryRefreshAt?: IsoTimestamp | null;
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}>;

export type AgentReliabilityFtsoStatus =
  "AVAILABLE" | "UNAVAILABLE" | "STALE" | "FAILED";

export type AgentCollateralRatioSource =
  "INVENTORY" | "FTSO_DERIVED" | "UNAVAILABLE";

export type StoredAgentReliabilityScoreRecord = Readonly<{
  agentVault: EvmAddress;
  score: number;
  formulaVersion: string;
  fulfillmentRate: number | null;
  fulfillmentScore: number;
  settlementTimeScore: number;
  defaultPenalty: number;
  availabilityScore: number;
  collateralScore: number;
  successfulRedemptions: number;
  defaultedRedemptions: number;
  totalTerminalRedemptions: number;
  averageSettlementSeconds: number | null;
  availability: AgentAvailability;
  availableLots: bigint;
  collateralRatioBips: bigint | null;
  collateralRatioSource: AgentCollateralRatioSource;
  ftsoStatus: AgentReliabilityFtsoStatus;
  ftsoXrpUsdPrice: string | null;
  ftsoFlrUsdPrice: string | null;
  ftsoTimestamp: string | null;
  ftsoError: string | null;
  componentsJson: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

export type UpsertAgentReliabilityScoreInput = Omit<
  StoredAgentReliabilityScoreRecord,
  "createdAt" | "updatedAt"
> &
  Readonly<{
    createdAt?: IsoTimestamp;
    updatedAt?: IsoTimestamp;
  }>;

export type StoredXrplPaymentObservation = XrplPaymentObservation &
  Readonly<{
    assetManagerAddress: EvmAddress | null;
    rawJson: string | null;
  }>;

export type UpsertXrplObservationInput = Readonly<{
  observationId: string;
  redemptionRequestId: RedemptionRequestId;
  assetManagerAddress?: EvmAddress | null;
  transactionHash: TransactionHash;
  sourceAddress: XrplAddress;
  destinationAddress: XrplAddress;
  deliveredAmountUBA: bigint;
  feeDrops: bigint;
  paymentReference: Bytes32;
  ledgerIndex: bigint;
  closeTimestamp?: IsoTimestamp;
  validatedAt: IsoTimestamp;
  rawJson?: string | null;
  createdAt?: IsoTimestamp;
}>;

export type StoredFdcRequestRecord = FdcRequestRecord &
  Readonly<{
    assetManagerAddress: EvmAddress | null;
    sourceChainId: string | null;
    submissionTransactionHash: TransactionHash | null;
    lastError: string | null;
    retryCount: number;
    nextRetryAt: IsoTimestamp | null;
  }>;

export type UpsertFdcRequestInput = Readonly<{
  fdcRequestId: string;
  redemptionRequestId: RedemptionRequestId;
  assetManagerAddress?: EvmAddress | null;
  attestationType: Bytes32;
  sourceId: Bytes32;
  sourceChainId?: string | null;
  requestBody: HexString;
  requestHash: Bytes32;
  status?: FdcRequestStatus;
  votingRoundId?: bigint | null;
  submissionTransactionHash?: TransactionHash | null;
  lastError?: string | null;
  retryCount?: number;
  nextRetryAt?: IsoTimestamp | null;
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}>;

export type UpdateFdcRequestStatusInput = Readonly<{
  fdcRequestId: string;
  status: FdcRequestStatus;
  votingRoundId?: bigint | null;
  submissionTransactionHash?: TransactionHash | null;
  lastError?: string | null;
  retryCount?: number;
  nextRetryAt?: IsoTimestamp | null;
  updatedAt?: IsoTimestamp;
}>;

export type StoredFdcProofRecord = FdcProofRecord &
  Readonly<{
    assetManagerAddress: EvmAddress | null;
    proofJson: string | null;
    calldataJson: string | null;
    proofReadyAt: IsoTimestamp | null;
  }>;

export type InsertFdcProofInput = Readonly<{
  fdcProofId: string;
  fdcRequestId: string;
  redemptionRequestId: RedemptionRequestId;
  assetManagerAddress?: EvmAddress | null;
  requestHash: Bytes32;
  responseBody: HexString;
  merkleProof: readonly Bytes32[];
  votingRoundId: bigint;
  proofJson?: string | null;
  calldataJson?: string | null;
  proofReadyAt?: IsoTimestamp | null;
  createdAt?: IsoTimestamp;
}>;

export type KeeperJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type KeeperJobRecord = Readonly<{
  jobId: string;
  jobType: string;
  status: KeeperJobStatus;
  assetManagerAddress: EvmAddress | null;
  redemptionRequestId: RedemptionRequestId | null;
  runAfter: IsoTimestamp;
  attempts: number;
  lockedAt: IsoTimestamp | null;
  lastError: string | null;
  payloadJson: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

export type UpsertKeeperJobInput = Readonly<{
  jobId: string;
  jobType: string;
  status?: KeeperJobStatus;
  assetManagerAddress?: EvmAddress | null;
  redemptionRequestId?: RedemptionRequestId | null;
  runAfter: IsoTimestamp;
  attempts?: number;
  lockedAt?: IsoTimestamp | null;
  lastError?: string | null;
  payloadJson?: string | null;
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}>;

export type SyncCursorRecord = Readonly<{
  cursorName: string;
  chainId: string | null;
  blockNumber: string;
  logIndex: string | null;
  payloadJson: string | null;
  updatedAt: IsoTimestamp;
}>;

export type UpsertSyncCursorInput = Readonly<{
  cursorName: string;
  chainId?: string | null;
  blockNumber: string;
  logIndex?: string | null;
  payloadJson?: string | null;
  updatedAt?: IsoTimestamp;
}>;
