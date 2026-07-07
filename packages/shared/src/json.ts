export type SerializedBigint = `${bigint}`;

export type JsonPrimitive = string | number | boolean | null;

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type JsonSafe<T> = T extends bigint
  ? SerializedBigint
  : T extends Date
    ? string
    : T extends readonly (infer Item)[]
      ? readonly JsonSafe<Item>[]
      : T extends (...args: never[]) => unknown
        ? never
        : T extends object
          ? { readonly [Key in keyof T]: JsonSafe<T[Key]> }
          : T;

const serializedBigintPattern = /^-?(0|[1-9]\d*)$/;

export function serializeBigint(value: bigint): SerializedBigint {
  return value.toString() as SerializedBigint;
}

export function parseSerializedBigint(value: string): bigint {
  const trimmedValue = value.trim();

  if (!serializedBigintPattern.test(trimmedValue)) {
    throw new Error(`Invalid serialized bigint: ${value}`);
  }

  return BigInt(trimmedValue);
}

export function serializeBigints<T>(value: T): JsonSafe<T> {
  if (typeof value === "bigint") {
    return serializeBigint(value) as JsonSafe<T>;
  }

  if (value === null || typeof value !== "object") {
    return value as JsonSafe<T>;
  }

  if (value instanceof Date) {
    return value.toISOString() as JsonSafe<T>;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBigints(item)) as JsonSafe<T>;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      serializeBigints(entryValue),
    ]),
  ) as JsonSafe<T>;
}
