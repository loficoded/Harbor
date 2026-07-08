import { openSqliteDatabase } from "./connection.js";
import { resetSqliteDatabase, runMigrations } from "./migrate.js";

type DbCommand = "create" | "migrate" | "reset";

const defaultDatabaseLocation = "./data/harbor.sqlite";

function usage(): string {
  return [
    "Usage: node dist/db/cli.js <create|migrate|reset> [--database <path-or-file-url>]",
    "",
    "Database location defaults to INDEXER_DB_URL or ./data/harbor.sqlite.",
  ].join("\n");
}

function parseDatabaseLocation(args: readonly string[]): string {
  const databaseFlagIndex = args.findIndex(
    (arg) => arg === "--database" || arg === "--db",
  );

  if (databaseFlagIndex >= 0) {
    const value = args[databaseFlagIndex + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error("--database requires a value");
    }

    return value;
  }

  return process.env.INDEXER_DB_URL ?? defaultDatabaseLocation;
}

function parseCommand(value: string | undefined): DbCommand {
  if (value === "create" || value === "migrate" || value === "reset") {
    return value;
  }

  throw new Error(usage());
}

function main(): void {
  const [, , commandValue, ...args] = process.argv;
  const command = parseCommand(commandValue);
  const databaseLocation = parseDatabaseLocation(args);

  if (command === "create") {
    const database = openSqliteDatabase(databaseLocation);
    database.close();
    console.log(`Created SQLite database at ${databaseLocation}`);
    return;
  }

  if (command === "migrate") {
    const database = openSqliteDatabase(databaseLocation);
    const results = runMigrations(database);
    database.close();
    const appliedCount = results.filter((result) => result.applied).length;
    console.log(
      `Ran ${appliedCount} migration${appliedCount === 1 ? "" : "s"} for ${databaseLocation}`,
    );
    return;
  }

  const database = resetSqliteDatabase(databaseLocation);
  database.close();
  console.log(`Reset SQLite database at ${databaseLocation}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
