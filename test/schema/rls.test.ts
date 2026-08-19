import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDMMF } from "@prisma/internals";
import { describe, expect, test } from "vitest";

// Amendment A (orchestrator declaration, carried from the M1-P1 review):
// the migration set must ENABLE ROW LEVEL SECURITY on EVERY public table
// Prisma declares, existing and new. No policies in v1: the app connects
// as table owner, so behaviour is unchanged; RLS-on is the charter's
// declared backstop (pulse-domain section 10: RLS is a backstop, not the
// mechanism). The deployed project currently has RLS off from a
// hand-applied schema, so the migration is what carries the fix out.
//
// Mechanism: derive the table names from the DMMF (BY NAME, never by
// count: this registry is append-only and a pinned count is false the
// moment the next phase adds a table) and assert each has an ENABLE ROW
// LEVEL SECURITY statement somewhere in the committed migration SQL. An
// inline-fixture test keeps the checker itself from going vacuously green.

const projectRoot = join(__dirname, "..", "..");
const schemaDir = join(projectRoot, "prisma", "schema");
const migrationsDir = join(schemaDir, "migrations");

const readSchemaFolder = (): string =>
  readdirSync(schemaDir)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => readFileSync(join(schemaDir, name), "utf-8"))
    .join("\n");

const readAllMigrationSql = (): string => {
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".sql")) {
        chunks.push(readFileSync(fullPath, "utf-8"));
      }
    }
  };
  walk(migrationsDir);
  return chunks.join("\n");
};

const declaredTableNames = async (): Promise<readonly string[]> => {
  const dmmf = await getDMMF({ datamodel: readSchemaFolder() });
  return dmmf.datamodel.models.map((model) => model.dbName ?? model.name);
};

// The checker under test: which declared tables lack an RLS enablement in
// the given SQL text? Quoted and unquoted table names both count; schema
// qualification ("public".) is optional in the statement.
export const tablesMissingRls = (
  tables: readonly string[],
  sql: string,
): string[] =>
  tables.filter((table) => {
    const pattern = new RegExp(
      `ALTER\\s+TABLE\\s+(?:"public"\\.|public\\.)?"?${table}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "i",
    );
    return !pattern.test(sql);
  });

describe("row level security is enabled by migration on every public table", () => {
  test("every table Prisma declares has ENABLE ROW LEVEL SECURITY in the migration SQL", async () => {
    const tables = await declaredTableNames();
    // Guard against vacuity from the schema side: the facts tables of this
    // phase must be among the declared names.
    expect(tables).toEqual(
      expect.arrayContaining(["households", "users", "transactions", "imports"]),
    );
    expect(tablesMissingRls(tables, readAllMigrationSql())).toEqual([]);
  });

  test("the checker reds on a table whose RLS enablement is missing", () => {
    const sql = `
CREATE TABLE "left_out" ("id" TEXT NOT NULL);
ALTER TABLE "covered" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."also_covered" ENABLE ROW LEVEL SECURITY;
`;
    expect(tablesMissingRls(["covered", "also_covered", "left_out"], sql)).toEqual([
      "left_out",
    ]);
  });

  test("the checker is not fooled by a DISABLE statement", () => {
    const sql = `ALTER TABLE "t" DISABLE ROW LEVEL SECURITY;`;
    expect(tablesMissingRls(["t"], sql)).toEqual(["t"]);
  });
});
