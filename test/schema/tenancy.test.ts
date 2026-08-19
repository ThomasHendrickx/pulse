import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { getDMMF } from "@prisma/internals";
import ts from "typescript";
import { describe, expect, test } from "vitest";

// The tenancy gate (criterion 0.4, hazard H0.1). Three named assertions,
// each with its mechanism named:
//   (a) householdId-on-every-model: reading the Prisma DMMF, every model
//       except Household carries a non-null householdId.
//   (b) money-fields-are-integer-cents: reading the same DMMF, every field
//       whose name matches /amount|balance|total|cents/i has type Int or
//       BigInt, never Float or Decimal.
//   (c) repositories-take-household-context: a static analysis over
//       src/modules using the TypeScript compiler API. FAIL CLOSED since fix
//       round 1 (finding CR-003 in both M1-P1 verdicts), widened in M1-P2
//       for finding CR-007: NAMING the database client module anywhere in
//       the source text (static import, dynamic import, import-equals) is
//       what holds a file to the rule, wherever it lives; such a file must
//       sit in an adapters/ directory, and every value it exports must be a
//       function declaring a parameter typed exactly HouseholdContext.
//       Every exported statement kind without a positive analyzer arm
//       (object literals, wrapped factories, classes, enums, namespaces,
//       default exports, re-exports, exported import-equals) is a VIOLATION
//       by default, so an uninspected shape reddens the suite instead of
//       passing it. Residue, stated rather than implied: call sites,
//       injected clients, and aliasing modules that hide the client
//       specifier stay review territory.
// Each mechanism is additionally exercised against inline fixtures that MUST
// produce violations, so a checker that silently stopped finding anything
// turns the suite red instead of going vacuously green.

const projectRoot = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Shared: load the real schema folder as one datamodel string.
// ---------------------------------------------------------------------------

const schemaDir = join(projectRoot, "prisma", "schema");

const readSchemaFolder = (): string =>
  readdirSync(schemaDir)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => readFileSync(join(schemaDir, name), "utf-8"))
    .join("\n");

type DmmfField = {
  readonly name: string;
  readonly kind: string;
  readonly isRequired: boolean;
  readonly type: string;
};

type DmmfModel = {
  readonly name: string;
  readonly fields: readonly DmmfField[];
};

const modelsOf = async (datamodel: string): Promise<readonly DmmfModel[]> => {
  const dmmf = await getDMMF({ datamodel });
  return dmmf.datamodel.models as unknown as readonly DmmfModel[];
};

// ---------------------------------------------------------------------------
// Mechanism (a): every model except Household carries a non-null householdId.
// ---------------------------------------------------------------------------

const modelsMissingHouseholdId = (models: readonly DmmfModel[]): string[] =>
  models
    .filter((model) => model.name !== "Household")
    .filter((model) => {
      const field = model.fields.find((f) => f.name === "householdId");
      return (
        field === undefined ||
        field.kind !== "scalar" ||
        !field.isRequired ||
        field.type !== "String"
      );
    })
    .map((model) => model.name);

// ---------------------------------------------------------------------------
// Mechanism (b): money-named fields are Int or BigInt, never Float/Decimal.
// ---------------------------------------------------------------------------

const MONEY_FIELD_NAME = /amount|balance|total|cents/i;

const moneyFieldViolations = (models: readonly DmmfModel[]): string[] =>
  models.flatMap((model) =>
    model.fields
      .filter((field) => field.kind === "scalar" && MONEY_FIELD_NAME.test(field.name))
      .filter((field) => field.type !== "Int" && field.type !== "BigInt")
      .map((field) => `${model.name}.${field.name} is ${field.type}`),
  );

// ---------------------------------------------------------------------------
// Mechanism (c): fail-closed static analysis over src/modules.
// A file is HELD TO THE REPOSITORY RULE when it imports the database client
// (@prisma/client or platform/db/client) or its basename names a repository.
// Held files must live under adapters/, and every exported VALUE must be a
// function declaring a parameter whose type text is exactly
// HouseholdContext. Type-only exports (interface, type alias, export type)
// are exempt: they carry no runtime behaviour. Everything else exported
// from a held file is a violation by construction (fail closed).
// ---------------------------------------------------------------------------

const HOUSEHOLD_CONTEXT_TYPE = "HouseholdContext";
const DB_CLIENT_IMPORT = /(@prisma\/client|platform\/db\/client)/;
const REPOSITORY_FILE_NAME = /repositor/i;

type TenancyViolation = {
  readonly file: string;
  readonly name: string;
  readonly reason: string;
};

const analyzeModuleSource = (
  sourceText: string,
  filePath: string,
): TenancyViolation[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: TenancyViolation[] = [];

  // Held-to-rule detection is a SOURCE-TEXT scan, not an import-statement
  // walk: a dynamic `await import(...)`, an import-equals form and any
  // other way of naming the client module all hold the file to the rule
  // (finding CR-007). Fail closed: a file merely mentioning the client
  // specifier (even in a comment) is held, which errs in the direction of
  // demanding the context parameter rather than skipping the check.
  const importsDbClient = DB_CLIENT_IMPORT.test(sourceText);
  const inAdapters = filePath.split(/[\\/]/).includes("adapters");
  const heldToRule =
    importsDbClient || REPOSITORY_FILE_NAME.test(basename(filePath));

  if (importsDbClient && !inAdapters) {
    violations.push({
      file: filePath,
      name: "(file)",
      reason:
        "imports the database client outside an adapters directory; only adapters may touch the database",
    });
  }

  if (!heldToRule) {
    return violations;
  }

  const isExported = (node: ts.HasModifiers): boolean =>
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  const declaresContextParameter = (fn: ts.SignatureDeclaration): boolean =>
    fn.parameters.some(
      (parameter) =>
        parameter.type !== undefined &&
        parameter.type.getText(sourceFile).trim() === HOUSEHOLD_CONTEXT_TYPE,
    );

  // First pass: index top-level declarations so export lists can resolve.
  const topLevelFunctions = new Map<string, ts.FunctionDeclaration>();
  const topLevelInitializers = new Map<string, ts.Expression | undefined>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelFunctions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          topLevelInitializers.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  const checkFunctionLike = (
    fn: ts.SignatureDeclaration,
    exportName: string,
  ): void => {
    if (!declaresContextParameter(fn)) {
      violations.push({
        file: filePath,
        name: exportName,
        reason: `exported function does not declare a parameter typed exactly ${HOUSEHOLD_CONTEXT_TYPE}`,
      });
    }
  };

  const flagUnverifiable = (exportName: string, shape: string): void => {
    violations.push({
      file: filePath,
      name: exportName,
      reason: `exported ${shape} is not a shape this gate can verify; repository files export only functions taking ${HOUSEHOLD_CONTEXT_TYPE}`,
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      checkFunctionLike(statement, statement.name?.text ?? "(anonymous)");
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(sourceFile);
        const initializer = declaration.initializer;
        if (
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          checkFunctionLike(initializer, name);
        } else {
          flagUnverifiable(
            name,
            "non-function value (object literal, call result or other initializer)",
          );
        }
      }
    } else if (ts.isClassDeclaration(statement) && isExported(statement)) {
      flagUnverifiable(statement.name?.text ?? "(anonymous class)", "class");
    } else if (ts.isEnumDeclaration(statement) && isExported(statement)) {
      flagUnverifiable(statement.name.text, "enum");
    } else if (ts.isExportAssignment(statement)) {
      flagUnverifiable("(default export)", "default export");
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) {
        continue;
      }
      if (statement.moduleSpecifier !== undefined) {
        flagUnverifiable(
          statement.getText(sourceFile).slice(0, 60),
          "re-export from another file (opaque to this gate)",
        );
        continue;
      }
      if (
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const specifier of statement.exportClause.elements) {
          if (specifier.isTypeOnly) {
            continue;
          }
          const localName = (specifier.propertyName ?? specifier.name).text;
          const exportedName = specifier.name.text;
          const fn = topLevelFunctions.get(localName);
          const initializer = topLevelInitializers.get(localName);
          if (fn !== undefined) {
            checkFunctionLike(fn, exportedName);
          } else if (
            initializer !== undefined &&
            (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
          ) {
            checkFunctionLike(initializer, exportedName);
          } else {
            flagUnverifiable(
              exportedName,
              "export-list entry not resolvable to a local function",
            );
          }
        }
      }
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      // Type-only declarations carry no runtime behaviour: exempt.
    } else if (ts.canHaveModifiers(statement) && isExported(statement)) {
      // FAIL-CLOSED DEFAULT (finding CR-007): any exported statement kind
      // without an explicit arm above (namespace and module declarations,
      // exported import-equals, and whatever TypeScript grows next) is a
      // violation by construction, so a new shape reddens the gate instead
      // of slipping through it.
      const name =
        ts.isModuleDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement)
          ? statement.name.getText(sourceFile)
          : statement.getText(sourceFile).slice(0, 60);
      flagUnverifiable(
        name,
        `statement of kind ${ts.SyntaxKind[statement.kind]} (no analyzer arm, default-flagged)`,
      );
    }
  }

  return violations;
};

const collectModuleFiles = (): string[] => {
  const modulesRoot = join(projectRoot, "src", "modules");
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
        found.push(fullPath);
      }
    }
  };

  walk(modulesRoot);
  return found;
};

// ---------------------------------------------------------------------------
// The suite.
// ---------------------------------------------------------------------------

describe("householdId-on-every-model (DMMF)", () => {
  test("every model except Household carries a non-null String householdId", async () => {
    const models = await modelsOf(readSchemaFolder());
    expect(models.length).toBeGreaterThan(1);
    expect(modelsMissingHouseholdId(models)).toEqual([]);
  });

  test("the checker reds on a missing and on an optional householdId", async () => {
    const fixture = `
model Household {
  id String @id
}

model Orphan {
  id String @id
}

model Loose {
  id          String  @id
  householdId String?
}
`;
    const models = await modelsOf(fixture);
    expect(modelsMissingHouseholdId(models)).toEqual(["Orphan", "Loose"]);
  });
});

describe("money-fields-are-integer-cents (DMMF)", () => {
  test("every money-named field in the real schema is Int or BigInt", async () => {
    const models = await modelsOf(readSchemaFolder());
    expect(moneyFieldViolations(models)).toEqual([]);
  });

  test("the checker reds on Float and Decimal money fields and accepts Int", async () => {
    // The datasource block makes Decimal legal in the fixture; without a
    // connector Prisma rejects the type before the checker can see it.
    const fixture = `
datasource db {
  provider = "postgresql"
  url      = "postgresql://localhost:5432/fixture"
}

model Household {
  id String @id
}

model Wrong {
  id           String  @id
  householdId  String
  amountCents  Float
  balanceTotal Decimal
}

model Right {
  id          String @id
  householdId String
  totalCents  Int
}
`;
    const models = await modelsOf(fixture);
    expect(moneyFieldViolations(models)).toEqual([
      "Wrong.amountCents is Float",
      "Wrong.balanceTotal is Decimal",
    ]);
  });
});

describe("repositories-take-household-context (TypeScript compiler API, fail closed)", () => {
  const DB_IMPORT_LINE = `import { prisma } from "@/platform/db/client";\n`;
  const ADAPTER_PATH = "src/modules/accounts/adapters/account-repository.ts";

  test("the real src/modules tree has no tenancy violations", () => {
    const files = collectModuleFiles();
    const violations = files.flatMap((file) =>
      analyzeModuleSource(readFileSync(file, "utf-8"), relative(projectRoot, file)),
    );
    // No repository files exist yet in the skeleton (modules land with
    // their own phases); the mechanism tests below keep this from being
    // vacuous by proving the analyzer reds on every unverifiable shape.
    expect(violations).toEqual([]);
  });

  test("reds on inline exported functions missing the context parameter", () => {
    const decl =
      DB_IMPORT_LINE +
      `export async function findTransactions(month: string) { return prisma; }\n`;
    const arrow =
      DB_IMPORT_LINE + `export const listAccounts = async (ids: string[]) => prisma;\n`;
    expect(analyzeModuleSource(decl, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "findTransactions",
    ]);
    expect(analyzeModuleSource(arrow, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "listAccounts",
    ]);
  });

  test("reds on the object-literal repository shape (fail-open before fix round 1)", () => {
    const source =
      DB_IMPORT_LINE +
      `export const accountRepository = {\n  list: async (month: string) => prisma,\n};\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "accountRepository",
    ]);
  });

  test("reds on the wrapped-factory shape such as cache() (fail-open before fix round 1)", () => {
    const source =
      `import { cache } from "react";\n` +
      DB_IMPORT_LINE +
      `export const getAccounts = cache(async (id: string) => prisma);\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "getAccounts",
    ]);
  });

  test("reds on the class repository shape (fail-open before fix round 1)", () => {
    const source =
      DB_IMPORT_LINE +
      `export class AccountRepository {\n  async list(month: string) { return prisma; }\n}\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "AccountRepository",
    ]);
  });

  test("reds on a context-free function exported via an export list (fail-open before fix round 1)", () => {
    const source =
      DB_IMPORT_LINE +
      `const listAccounts = async (month: string) => prisma;\nexport { listAccounts };\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "listAccounts",
    ]);
  });

  test("accepts a context-taking function exported via an export list", () => {
    const source =
      DB_IMPORT_LINE +
      `import type { HouseholdContext } from "@/platform/tenancy";\n` +
      `const listAccounts = async (context: HouseholdContext) => prisma;\nexport { listAccounts };\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH)).toEqual([]);
  });

  test("reds on a re-export from another file (opaque, so refused)", () => {
    const source = DB_IMPORT_LINE + `export { listAccounts } from "./impl";\n`;
    const violations = analyzeModuleSource(source, ADAPTER_PATH);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("re-export");
  });

  test("reds on a database client import outside an adapters directory", () => {
    const source =
      DB_IMPORT_LINE +
      `import type { HouseholdContext } from "@/platform/tenancy";\n` +
      `export const sumTotals = async (context: HouseholdContext) => prisma;\n`;
    const violations = analyzeModuleSource(
      source,
      "src/modules/ledger/domain/totals.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("outside an adapters directory");
  });

  test("reds on a wrapper around the context type (exact match required)", () => {
    const source =
      DB_IMPORT_LINE +
      `import type { HouseholdContext } from "@/platform/tenancy";\n` +
      `export const listAccounts = async (context: Partial<HouseholdContext>) => prisma;\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH).map((v) => v.name)).toEqual([
      "listAccounts",
    ]);
  });

  test("holds repository-named adapter files to the rule even without a db import", () => {
    const source = `export const listAccounts = async (month: string) => [];\n`;
    const violations = analyzeModuleSource(
      source,
      "src/modules/accounts/adapters/csv-account-repository.ts",
    );
    expect(violations.map((v) => v.name)).toEqual(["listAccounts"]);
  });

  test("accepts a compliant repository file including type-only exports", () => {
    const source =
      DB_IMPORT_LINE +
      `import type { HouseholdContext } from "@/platform/tenancy";\n` +
      `export type AccountRow = { id: string };\n` +
      `export interface AccountFilter { month: string }\n` +
      `export async function findAccounts(context: HouseholdContext) { return prisma; }\n` +
      `export const countAccounts = async (context: HouseholdContext) => prisma;\n`;
    expect(analyzeModuleSource(source, ADAPTER_PATH)).toEqual([]);
  });

  test("leaves non-repository adapter files (no db import) unconstrained, as documented", () => {
    const source = `export const parseStatementLine = (line: string) => line.split(";");\n`;
    expect(
      analyzeModuleSource(source, "src/modules/import/adapters/csv-parser.ts"),
    ).toEqual([]);
  });

  // Finding CR-007 (M1-P1 hazard review): three unidiomatic shapes escaped
  // the analyzer entirely. Each is a red fixture now: a checker that stops
  // seeing them turns this suite red instead of vacuously green.

  test("reds on a dynamic import of the db client (held to the rule by source-text scan)", () => {
    const source =
      `export const listAccounts = async (month: string) =>\n` +
      `  (await import("@/platform/db/client")).prisma;\n`;
    expect(
      analyzeModuleSource(
        source,
        "src/modules/accounts/adapters/account-loader.ts",
      ).map((v) => v.name),
    ).toEqual(["listAccounts"]);
  });

  test("reds on an import-equals form reaching the db client", () => {
    const source =
      `import db = require("@/platform/db/client");\n` +
      `export const listAccounts = async (month: string) => db.prisma;\n`;
    expect(
      analyzeModuleSource(
        source,
        "src/modules/accounts/adapters/account-loader.ts",
      ).map((v) => v.name),
    ).toEqual(["listAccounts"]);
  });

  test("reds on an exported namespace in a held file (default-flagged statement kind)", () => {
    const source =
      DB_IMPORT_LINE +
      `export namespace accountRepo {\n` +
      `  export const list = async (month: string) => prisma;\n` +
      `}\n`;
    const violations = analyzeModuleSource(source, ADAPTER_PATH);
    expect(violations.map((v) => v.name)).toEqual(["accountRepo"]);
  });

  test("reds on a dynamic db import outside an adapters directory", () => {
    const source =
      `export const sneak = async () => (await import("@prisma/client")).PrismaClient;\n`;
    const violations = analyzeModuleSource(
      source,
      "src/modules/ledger/domain/sneak.ts",
    );
    expect(
      violations.some((v) => v.reason.includes("outside an adapters directory")),
    ).toBe(true);
  });
});
