import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

export type SqliteDatabase = ReturnType<typeof Database>;

export type OpenSqliteDatabaseOptions = Readonly<{
  readonly?: boolean;
}>;

const memoryDatabaseLocation = ":memory:";

export function resolveSqliteDatabasePath(databaseLocation: string): string {
  const trimmedLocation = databaseLocation.trim();

  if (trimmedLocation === memoryDatabaseLocation) {
    return trimmedLocation;
  }

  if (trimmedLocation.startsWith("file:")) {
    return fileURLToPath(new URL(trimmedLocation));
  }

  if (trimmedLocation.startsWith("sqlite:")) {
    const sqliteLocation = trimmedLocation.slice("sqlite:".length);

    if (sqliteLocation === memoryDatabaseLocation) {
      return memoryDatabaseLocation;
    }

    if (sqliteLocation.startsWith("//")) {
      return fileURLToPath(new URL(`file:${sqliteLocation}`));
    }

    if (sqliteLocation.length === 0) {
      throw new Error("SQLite database location cannot be empty");
    }

    return sqliteLocation;
  }

  if (
    trimmedLocation.startsWith("postgres:") ||
    trimmedLocation.startsWith("postgresql:")
  ) {
    throw new Error("Only SQLite database locations are supported locally");
  }

  if (trimmedLocation.length === 0) {
    throw new Error("SQLite database location cannot be empty");
  }

  return trimmedLocation;
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === memoryDatabaseLocation) {
    return;
  }

  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

export function openSqliteDatabase(
  databaseLocation: string,
  options: OpenSqliteDatabaseOptions = {},
): SqliteDatabase {
  const databasePath = resolveSqliteDatabasePath(databaseLocation);
  ensureDatabaseDirectory(databasePath);

  const database = new Database(databasePath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  if (!options.readonly && databasePath !== memoryDatabaseLocation) {
    database.pragma("journal_mode = WAL");
  }

  return database;
}
