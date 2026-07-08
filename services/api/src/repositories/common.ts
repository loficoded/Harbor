import type { IsoTimestamp } from "@harbor/shared";

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function requireRow<T>(row: T | null | undefined, message: string): T {
  if (row === undefined || row === null) {
    throw new Error(message);
  }

  return row;
}

export function optionalRow<T>(row: T | undefined): T | null {
  return row ?? null;
}

export function parseJsonPayload(value: string): unknown {
  return JSON.parse(value) as unknown;
}
