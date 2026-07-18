import {
  netUnderlyingUBA,
  normalizeBytes32,
  normalizeTransactionHash,
  serializeBigints,
  type Bytes32,
  type TransactionHash,
} from "@harbor/shared";
import type {
  AccountTxRequest,
  AccountTxResponse,
} from "xrpl/dist/npm/models/methods/index.js";

import type { SqliteDatabase } from "../db/index.js";
import {
  getXrplObservationByTransaction,
  upsertXrplObservation,
  updateRedemptionStatus,
} from "../repositories/index.js";
import type {
  StoredRedemptionRequest,
  StoredXrplPaymentObservation,
} from "../repositories/types.js";
import type { XrplObservationClient } from "./client.js";
import {
  decodeXrplDestinationTag,
  decodeXrplPaymentReferences,
} from "./paymentReference.js";

export type XrplPaymentRejectionReason =
  | "not-payment"
  | "missing-transaction-hash"
  | "missing-ledger-index"
  | "missing-close-timestamp"
  | "unvalidated-transaction"
  | "failed-transaction"
  | "wrong-destination"
  | "wrong-payment-reference"
  | "wrong-destination-tag"
  | "unsupported-delivered-amount"
  | "insufficient-delivered-amount"
  | "out-of-window";

export type NormalizedXrplPayment = Readonly<{
  transactionHash: TransactionHash;
  sourceAddress: string;
  destinationAddress: string;
  deliveredAmountUBA: bigint | null;
  feeDrops: bigint;
  paymentReferences: readonly Bytes32[];
  /** XRPL `DestinationTag`, or `null` when the payment carried none. */
  destinationTag: bigint | null;
  ledgerIndex: bigint;
  closeTimestamp: string | null;
  closeTimestampSeconds: bigint | null;
  transactionResult: string | null;
  validated: boolean;
  raw: unknown;
}>;

export type XrplPaymentMatchResult =
  | Readonly<{
      matched: true;
      payment: NormalizedXrplPayment &
        Readonly<{
          deliveredAmountUBA: bigint;
          closeTimestamp: string;
          closeTimestampSeconds: bigint;
        }>;
    }>
  | Readonly<{
      matched: false;
      reason: XrplPaymentRejectionReason;
      payment: NormalizedXrplPayment | null;
    }>;

export type PersistXrplPaymentObservationResult =
  | Readonly<{
      persisted: true;
      duplicate: boolean;
      observation: StoredXrplPaymentObservation;
      redemption: StoredRedemptionRequest;
    }>
  | Readonly<{
      persisted: false;
      reason: XrplPaymentRejectionReason;
      payment: NormalizedXrplPayment | null;
    }>;

export type ObserveXrplPaymentsSummary = Readonly<{
  transactionsScanned: number;
  observationsPersisted: number;
  duplicateObservations: number;
  redemptionsSettled: number;
  rejected: Partial<Record<XrplPaymentRejectionReason, number>>;
}>;

export type BackfillRedemptionXrplPaymentsInput = Readonly<{
  database: SqliteDatabase;
  client: XrplObservationClient;
  redemption: StoredRedemptionRequest;
  pageLimit?: number;
  accountTxLimit?: number;
}>;

export type WatchXrplRedemptionPaymentsInput = Readonly<{
  database: SqliteDatabase;
  client: XrplObservationClient;
  redemptions: readonly StoredRedemptionRequest[];
  onError?: (error: Error) => void;
}>;

type MutableObserveXrplPaymentsSummary = {
  -readonly [
    Key in keyof ObserveXrplPaymentsSummary
  ]: ObserveXrplPaymentsSummary[Key];
};

type XrplPaymentTransactionLike = Readonly<{
  TransactionType?: unknown;
  Account?: unknown;
  Destination?: unknown;
  Amount?: unknown;
  Fee?: unknown;
  InvoiceID?: unknown;
  Memos?: readonly Readonly<{ Memo?: Readonly<{ MemoData?: unknown }> }>[];
  DestinationTag?: unknown;
  date?: unknown;
  hash?: unknown;
  ledger_index?: unknown;
  inLedger?: unknown;
}>;

type XrplMetadataLike = Readonly<{
  TransactionResult?: unknown;
  delivered_amount?: unknown;
  DeliveredAmount?: unknown;
}>;

type XrplRawPaymentContainer = Readonly<{
  tx?: unknown;
  transaction?: unknown;
  meta?: unknown;
  metaData?: unknown;
  validated?: unknown;
  ledger_index?: unknown;
  engine_result?: unknown;
}>;

const rippleEpochOffsetSeconds = 946_684_800n;

function createEmptySummary(): MutableObserveXrplPaymentsSummary {
  return {
    transactionsScanned: 0,
    observationsPersisted: 0,
    duplicateObservations: 0,
    redemptionsSettled: 0,
    rejected: {},
  };
}

function incrementRejection(
  summary: MutableObserveXrplPaymentsSummary,
  reason: XrplPaymentRejectionReason,
): void {
  summary.rejected[reason] = (summary.rejected[reason] ?? 0) + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decimalBigint(value: unknown, fieldName: string): bigint | null {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return BigInt(value);
  }

  if (fieldName.length > 0) {
    return null;
  }

  return null;
}

function decimalNumber(value: bigint, fieldName: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} exceeds JavaScript safe integer range`);
  }

  return Number(value);
}

function rippleTimeToIsoTimestamp(rippleTime: bigint): string {
  return new Date(
    Number(rippleTime + rippleEpochOffsetSeconds) * 1_000,
  ).toISOString();
}

function rippleTimeToUnixSeconds(rippleTime: bigint): bigint {
  return rippleTime + rippleEpochOffsetSeconds;
}

function getTransactionAndMetadata(raw: unknown): {
  transaction: XrplPaymentTransactionLike | null;
  metadata: XrplMetadataLike | null;
  validated: boolean;
  ledgerIndex: bigint | null;
  engineResult: string | null;
} {
  if (!isRecord(raw)) {
    return {
      transaction: null,
      metadata: null,
      validated: false,
      ledgerIndex: null,
      engineResult: null,
    };
  }

  const container = raw as XrplRawPaymentContainer;
  const transaction =
    isRecord(container.tx) || isRecord(container.transaction)
      ? ((container.tx ?? container.transaction) as XrplPaymentTransactionLike)
      : (raw as XrplPaymentTransactionLike);
  const metadata =
    isRecord(container.meta) || isRecord(container.metaData)
      ? ((container.meta ?? container.metaData) as XrplMetadataLike)
      : null;
  const ledgerIndex =
    decimalBigint(container.ledger_index, "ledger_index") ??
    decimalBigint(transaction.ledger_index, "transaction.ledger_index") ??
    decimalBigint(transaction.inLedger, "transaction.inLedger");
  const engineResult =
    typeof container.engine_result === "string"
      ? container.engine_result
      : null;

  return {
    transaction,
    metadata,
    validated: container.validated === true,
    ledgerIndex,
    engineResult,
  };
}

function deliveredAmountFrom(
  transaction: XrplPaymentTransactionLike,
  metadata: XrplMetadataLike | null,
): bigint | null {
  const deliveredAmount =
    metadata?.delivered_amount ??
    metadata?.DeliveredAmount ??
    transaction.Amount;

  if (typeof deliveredAmount !== "string") {
    return null;
  }

  return decimalBigint(deliveredAmount, "delivered_amount");
}

function feeDropsFrom(transaction: XrplPaymentTransactionLike): bigint {
  return decimalBigint(transaction.Fee, "Fee") ?? 0n;
}

function transactionResultFrom(
  metadata: XrplMetadataLike | null,
  engineResult: string | null,
): string | null {
  if (typeof metadata?.TransactionResult === "string") {
    return metadata.TransactionResult;
  }

  return engineResult;
}

function normalizeReferenceList(
  references: readonly Bytes32[],
): readonly Bytes32[] {
  return [
    ...new Set(references.map((reference) => normalizeBytes32(reference))),
  ];
}

export function normalizeXrplPayment(
  raw: unknown,
): NormalizedXrplPayment | null {
  const { transaction, metadata, validated, ledgerIndex, engineResult } =
    getTransactionAndMetadata(raw);

  if (transaction === null || transaction.TransactionType !== "Payment") {
    return null;
  }

  if (typeof transaction.hash !== "string") {
    return {
      transactionHash: "0x" as TransactionHash,
      sourceAddress: "",
      destinationAddress: "",
      deliveredAmountUBA: null,
      feeDrops: 0n,
      paymentReferences: [],
      destinationTag: decodeXrplDestinationTag(transaction),
      ledgerIndex: ledgerIndex ?? 0n,
      closeTimestamp: null,
      closeTimestampSeconds: null,
      transactionResult: transactionResultFrom(metadata, engineResult),
      validated,
      raw,
    };
  }

  const rippleCloseTimestampSeconds = decimalBigint(transaction.date, "date");
  const closeTimestampSeconds =
    rippleCloseTimestampSeconds === null
      ? null
      : rippleTimeToUnixSeconds(rippleCloseTimestampSeconds);
  const closeTimestamp =
    rippleCloseTimestampSeconds === null
      ? null
      : rippleTimeToIsoTimestamp(rippleCloseTimestampSeconds);

  let transactionHash: TransactionHash;
  try {
    transactionHash = normalizeTransactionHash(transaction.hash);
  } catch {
    transactionHash = "0x" as TransactionHash;
  }

  return {
    transactionHash,
    sourceAddress:
      typeof transaction.Account === "string" ? transaction.Account : "",
    destinationAddress:
      typeof transaction.Destination === "string"
        ? transaction.Destination
        : "",
    deliveredAmountUBA: deliveredAmountFrom(transaction, metadata),
    feeDrops: feeDropsFrom(transaction),
    paymentReferences: normalizeReferenceList(
      decodeXrplPaymentReferences(transaction),
    ),
    destinationTag: decodeXrplDestinationTag(transaction),
    ledgerIndex: ledgerIndex ?? 0n,
    closeTimestamp,
    closeTimestampSeconds,
    transactionResult: transactionResultFrom(metadata, engineResult),
    validated,
    raw,
  };
}

export function matchXrplPaymentToRedemption(
  redemption: StoredRedemptionRequest,
  rawPayment: unknown,
): XrplPaymentMatchResult {
  const payment = normalizeXrplPayment(rawPayment);

  if (payment === null) {
    return { matched: false, reason: "not-payment", payment: null };
  }

  const closeTimestamp = payment.closeTimestamp;
  const closeTimestampSeconds = payment.closeTimestampSeconds;

  if (payment.transactionHash === "0x") {
    return { matched: false, reason: "missing-transaction-hash", payment };
  }

  if (payment.ledgerIndex === 0n) {
    return { matched: false, reason: "missing-ledger-index", payment };
  }

  if (closeTimestamp === null || closeTimestampSeconds === null) {
    return { matched: false, reason: "missing-close-timestamp", payment };
  }

  if (!payment.validated) {
    return { matched: false, reason: "unvalidated-transaction", payment };
  }

  if (payment.transactionResult !== "tesSUCCESS") {
    return { matched: false, reason: "failed-transaction", payment };
  }

  if (payment.destinationAddress !== redemption.paymentAddress) {
    return { matched: false, reason: "wrong-destination", payment };
  }

  if (!payment.paymentReferences.includes(redemption.paymentReference)) {
    return { matched: false, reason: "wrong-payment-reference", payment };
  }

  // A redeem-by-tag (WITH_TAG) redemption settles only when the agent's XRPL
  // payment carries the exact required DestinationTag. Tag `0` is a valid tag:
  // it must match a payment whose DestinationTag is `0`. Standard redemptions
  // ignore the tag entirely (backward-compatible).
  if (
    redemption.redemptionKind === "WITH_TAG" &&
    redemption.destinationTag !== null &&
    payment.destinationTag !== redemption.destinationTag
  ) {
    return { matched: false, reason: "wrong-destination-tag", payment };
  }

  if (payment.deliveredAmountUBA === null) {
    return { matched: false, reason: "unsupported-delivered-amount", payment };
  }

  const deliveredAmountUBA = payment.deliveredAmountUBA;

  // FAssets agents deliver the redemption value minus the redemption fee they
  // keep, so the redeemer's underlying address legitimately receives the net
  // amount (valueUBA - feeUBA). Comparing against the gross valueUBA rejected
  // every valid payment (the on-chain RedemptionPerformed settles on this same
  // net amount). Shared with the keeper state machine via netUnderlyingUBA so
  // the two settlement checks can never drift.
  const requiredDeliveredUBA = netUnderlyingUBA(
    redemption.valueUBA,
    redemption.feeUBA,
  );

  if (deliveredAmountUBA < requiredDeliveredUBA) {
    return {
      matched: false,
      reason: "insufficient-delivered-amount",
      payment,
    };
  }

  if (
    payment.ledgerIndex < redemption.firstUnderlyingBlock ||
    payment.ledgerIndex > redemption.lastUnderlyingBlock ||
    closeTimestampSeconds > redemption.lastUnderlyingTimestamp
  ) {
    return { matched: false, reason: "out-of-window", payment };
  }

  return {
    matched: true,
    payment: {
      ...payment,
      deliveredAmountUBA,
      closeTimestamp,
      closeTimestampSeconds,
    },
  };
}

export function buildXrplObservationId(
  assetManagerAddress: string,
  redemptionRequestId: string,
  transactionHash: TransactionHash,
): string {
  return `xrpl:${assetManagerAddress.toLowerCase()}:${redemptionRequestId}:${transactionHash}`;
}

function buildRawNormalizedReceipt(payment: NormalizedXrplPayment): string {
  return JSON.stringify(
    serializeBigints({
      transactionHash: payment.transactionHash,
      sourceAddress: payment.sourceAddress,
      destinationAddress: payment.destinationAddress,
      deliveredAmountUBA: payment.deliveredAmountUBA,
      feeDrops: payment.feeDrops,
      paymentReferences: payment.paymentReferences,
      destinationTag: payment.destinationTag,
      ledgerIndex: payment.ledgerIndex,
      closeTimestamp: payment.closeTimestamp,
      transactionResult: payment.transactionResult,
      validated: payment.validated,
      raw: payment.raw,
    }),
  );
}

export function persistMatchedXrplPaymentObservation(
  database: SqliteDatabase,
  redemption: StoredRedemptionRequest,
  rawPayment: unknown,
): PersistXrplPaymentObservationResult {
  const match = matchXrplPaymentToRedemption(redemption, rawPayment);

  if (!match.matched) {
    return {
      persisted: false,
      reason: match.reason,
      payment: match.payment,
    };
  }

  const existing = getXrplObservationByTransaction(
    database,
    match.payment.transactionHash,
    redemption.requestId,
  );
  const persist = database.transaction(() => {
    const observation = upsertXrplObservation(database, {
      observationId: buildXrplObservationId(
        redemption.assetManagerAddress,
        redemption.requestId,
        match.payment.transactionHash,
      ),
      redemptionRequestId: redemption.requestId,
      assetManagerAddress: redemption.assetManagerAddress,
      transactionHash: match.payment.transactionHash,
      sourceAddress: match.payment.sourceAddress,
      destinationAddress: match.payment.destinationAddress,
      deliveredAmountUBA: match.payment.deliveredAmountUBA,
      feeDrops: match.payment.feeDrops,
      paymentReference: redemption.paymentReference,
      ledgerIndex: match.payment.ledgerIndex,
      closeTimestamp: match.payment.closeTimestamp,
      validatedAt: match.payment.closeTimestamp,
      destinationTag: match.payment.destinationTag,
      rawJson: buildRawNormalizedReceipt(match.payment),
    });
    const updatedRedemption = updateRedemptionStatus(database, {
      assetManagerAddress: redemption.assetManagerAddress,
      requestId: redemption.requestId,
      status: "SETTLED",
      transactionHash: match.payment.transactionHash,
      statusReason: "xrpl-payment-observed",
      updatedAt: match.payment.closeTimestamp,
    });

    return { observation, updatedRedemption };
  });
  const { observation, updatedRedemption } = persist();

  return {
    persisted: true,
    duplicate: existing !== null,
    observation,
    redemption: updatedRedemption,
  };
}

function observeRawPaymentAgainstRedemptions(
  database: SqliteDatabase,
  redemptions: readonly StoredRedemptionRequest[],
  rawPayment: unknown,
  summary: MutableObserveXrplPaymentsSummary,
): void {
  summary.transactionsScanned += 1;

  for (const redemption of redemptions) {
    const result = persistMatchedXrplPaymentObservation(
      database,
      redemption,
      rawPayment,
    );

    if (!result.persisted) {
      incrementRejection(summary, result.reason);
      continue;
    }

    if (result.duplicate) {
      summary.duplicateObservations += 1;
    } else {
      summary.observationsPersisted += 1;
    }

    if (result.redemption.status === "SETTLED") {
      summary.redemptionsSettled += 1;
    }
  }
}

function getAccountTxTransactions(response: unknown): readonly unknown[] {
  if (!isRecord(response) || !isRecord(response.result)) {
    return [];
  }

  const transactions = response.result.transactions;
  return Array.isArray(transactions) ? transactions : [];
}

function hasNextAccountTxPage(
  response: unknown,
): response is AccountTxResponse {
  return (
    isRecord(response) &&
    isRecord(response.result) &&
    response.result.marker !== undefined
  );
}

export async function backfillRedemptionXrplPayments(
  input: BackfillRedemptionXrplPaymentsInput,
): Promise<ObserveXrplPaymentsSummary> {
  const request: AccountTxRequest = {
    command: "account_tx",
    account: input.redemption.paymentAddress,
    ledger_index_min: decimalNumber(
      input.redemption.firstUnderlyingBlock,
      "firstUnderlyingBlock",
    ),
    ledger_index_max: decimalNumber(
      input.redemption.lastUnderlyingBlock,
      "lastUnderlyingBlock",
    ),
    binary: false,
    forward: true,
    limit: input.accountTxLimit ?? 200,
  };
  const summary = createEmptySummary();
  let response = await input.client.request(request);
  let pagesRead = 0;

  while (true) {
    pagesRead += 1;

    for (const transaction of getAccountTxTransactions(response)) {
      observeRawPaymentAgainstRedemptions(
        input.database,
        [input.redemption],
        transaction,
        summary,
      );
    }

    if (!hasNextAccountTxPage(response)) {
      return summary;
    }

    if (input.pageLimit !== undefined && pagesRead >= input.pageLimit) {
      return summary;
    }

    if (input.client.requestNextPage !== undefined) {
      response = await input.client.requestNextPage(request, response);
    } else {
      response = await input.client.request({
        ...request,
        marker: response.result.marker,
      });
    }
  }
}

export async function watchXrplRedemptionPayments(
  input: WatchXrplRedemptionPaymentsInput,
): Promise<() => Promise<void>> {
  if (input.client.subscribeToAccounts === undefined) {
    throw new Error("XRPL client does not support live account subscriptions");
  }

  const paymentAddresses = [
    ...new Set(
      input.redemptions.map((redemption) => redemption.paymentAddress),
    ),
  ];

  return input.client.subscribeToAccounts(
    paymentAddresses,
    (transaction) => {
      for (const redemption of input.redemptions) {
        persistMatchedXrplPaymentObservation(
          input.database,
          redemption,
          transaction,
        );
      }
    },
    input.onError,
  );
}
