import { existsSync, rmSync } from "node:fs";

import {
  openSqliteDatabase,
  resolveSqliteDatabasePath,
  type SqliteDatabase,
} from "./connection.js";
import { migrations, type SqlMigration } from "./migrations/index.js";

export type AppliedMigration = Readonly<{
  id: string;
  appliedAt: string;
}>;

export type MigrationResult = Readonly<{
  id: string;
  applied: boolean;
}>;

type SchemaMigrationRow = Readonly<{
  id: string;
  applied_at: string;
}>;

const schemaMigrationsSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

export function ensureSchemaMigrationsTable(database: SqliteDatabase): void {
  database.exec(schemaMigrationsSql);
}

export function listAppliedMigrations(
  database: SqliteDatabase,
): readonly AppliedMigration[] {
  ensureSchemaMigrationsTable(database);

  const rows = database
    .prepare<[], SchemaMigrationRow>(
      "SELECT id, applied_at FROM schema_migrations ORDER BY id",
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    appliedAt: row.applied_at,
  }));
}

export function runMigrations(
  database: SqliteDatabase,
): readonly MigrationResult[] {
  ensureSchemaMigrationsTable(database);

  const appliedMigrationIds = new Set(
    listAppliedMigrations(database).map((migration) => migration.id),
  );
  const insertMigration = database.prepare<{ id: string; appliedAt: string }>(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @appliedAt)",
  );

  const applyMigration = database.transaction((migration: SqlMigration) => {
    database.exec(migration.sql);
    insertMigration.run({
      id: migration.id,
      appliedAt: new Date().toISOString(),
    });
  });

  const results: MigrationResult[] = [];

  for (const migration of migrations) {
    if (appliedMigrationIds.has(migration.id)) {
      results.push({ id: migration.id, applied: false });
      continue;
    }

    if (migration.useTransaction === false) {
      database.exec(migration.sql);
      insertMigration.run({
        id: migration.id,
        appliedAt: new Date().toISOString(),
      });
    } else {
      applyMigration(migration);
    }

    results.push({ id: migration.id, applied: true });
  }

  return results;
}

function removeDatabaseFiles(databasePath: string): void {
  for (const path of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

export function resetSqliteDatabase(databaseLocation: string): SqliteDatabase {
  const databasePath = resolveSqliteDatabasePath(databaseLocation);

  if (databasePath !== ":memory:") {
    removeDatabaseFiles(databasePath);
  }

  const database = openSqliteDatabase(databaseLocation);
  runMigrations(database);

  return database;
}
