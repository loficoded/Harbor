import { normalizeBytes32, type Bytes32 } from "@harbor/shared";

type XrplMemoLike = Readonly<{
  Memo?: Readonly<{
    MemoData?: unknown;
  }>;
}>;

type XrplPaymentReferenceCarrier = Readonly<{
  InvoiceID?: unknown;
  Memos?: readonly XrplMemoLike[];
}>;

const hexPattern = /^(0x)?[a-fA-F0-9]+$/;

function tryNormalizeBytes32(value: string): Bytes32 | null {
  try {
    return normalizeBytes32(value);
  } catch {
    return null;
  }
}

function decodeHexToUtf8(value: string): string | null {
  const hexValue = value.toLowerCase().startsWith("0x")
    ? value.slice(2)
    : value;

  if (hexValue.length % 2 !== 0 || !hexPattern.test(hexValue)) {
    return null;
  }

  return Buffer.from(hexValue, "hex").toString("utf8").replace(/\0+$/u, "");
}

export function decodeXrplMemoDataCandidates(value: string): readonly string[] {
  const candidates = new Set<string>();
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return [];
  }

  candidates.add(trimmedValue);

  const decodedUtf8 = decodeHexToUtf8(trimmedValue);
  if (decodedUtf8 !== null && decodedUtf8.trim().length > 0) {
    candidates.add(decodedUtf8.trim());
  }

  return [...candidates];
}

export function decodeXrplPaymentReferences(
  transaction: XrplPaymentReferenceCarrier,
): readonly Bytes32[] {
  const references = new Set<Bytes32>();

  if (typeof transaction.InvoiceID === "string") {
    const invoiceReference = tryNormalizeBytes32(transaction.InvoiceID);
    if (invoiceReference !== null) {
      references.add(invoiceReference);
    }
  }

  for (const memo of transaction.Memos ?? []) {
    const memoData = memo.Memo?.MemoData;
    if (typeof memoData !== "string") {
      continue;
    }

    for (const candidate of decodeXrplMemoDataCandidates(memoData)) {
      const memoReference = tryNormalizeBytes32(candidate);
      if (memoReference !== null) {
        references.add(memoReference);
      }
    }
  }

  return [...references];
}

export function xrplPaymentReferenceMatches(
  transaction: XrplPaymentReferenceCarrier,
  expectedPaymentReference: Bytes32,
): boolean {
  const expectedReference = normalizeBytes32(expectedPaymentReference);
  return decodeXrplPaymentReferences(transaction).includes(expectedReference);
}
