import { initialSchemaMigration } from "./0001_initial_schema.js";

export type SqlMigration = Readonly<{
  id: string;
  sql: string;
}>;

export const migrations = [
  initialSchemaMigration,
] as const satisfies readonly SqlMigration[];
