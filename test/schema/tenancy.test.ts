import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
//       src/modules/**/adapters using the TypeScript compiler API asserts
//       every exported repository function declares a parameter of the
//       household context type (HouseholdContext).
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
// Mechanism (c): exported functions in module adapters declare a parameter
// of the household context type. TypeScript compiler API, no execution.
// ---------------------------------------------------------------------------

const HOUSEHOLD_CONTEXT_TYPE = "HouseholdContext";

type RepositoryViolation = {
  readonly file: string;
  readonly exportName: string;
};

const analyzeAdapterSource = (
  sourceText: string,
  fileName: string,
): RepositoryViolation[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: RepositoryViolation[] = [];

  const isExported = (node: ts.HasModifiers): boolean =>
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  const declaresContextParameter = (fn: ts.SignatureDeclaration): boolean =>
    fn.parameters.some(
      (parameter) =>
        parameter.type !== undefined &&
        parameter.type.getText(sourceFile).includes(HOUSEHOLD_CONTEXT_TYPE),
    );

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && isExported(node)) {
      if (!declaresContextParameter(node)) {
        violations.push({
          file: fileName,
          exportName: node.name?.text ?? "(anonymous)",
        });
      }
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
          !declaresContextParameter(initializer)
        ) {
          violations.push({
            file: fileName,
            exportName: declaration.name.getText(sourceFile),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const collectAdapterFiles = (): string[] => {
  const modulesRoot = join(projectRoot, "src", "modules");
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (
        /\.(ts|tsx)$/.test(entry) &&
        fullPath.split(/[\\/]/).includes("adapters")
      ) {
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

describe("repositories-take-household-context (TypeScript compiler API)", () => {
  test("every exported function under src/modules/**/adapters declares a HouseholdContext parameter", () => {
    const files = collectAdapterFiles();
    const violations = files.flatMap((file) =>
      analyzeAdapterSource(readFileSync(file, "utf-8"), file),
    );
    // No adapters exist yet in the skeleton (modules land with their own
    // phases); the mechanism tests below keep this from being vacuous.
    expect(violations).toEqual([]);
  });

  test("the analyzer reds on two shapes of context-free exported functions", () => {
    const badDeclaration = `
      export async function findTransactions(month: string) { return []; }
    `;
    const badArrow = `
      export const listAccounts = async (ids: string[]) => [];
    `;
    expect(analyzeAdapterSource(badDeclaration, "bad-declaration.ts")).toEqual([
      { file: "bad-declaration.ts", exportName: "findTransactions" },
    ]);
    expect(analyzeAdapterSource(badArrow, "bad-arrow.ts")).toEqual([
      { file: "bad-arrow.ts", exportName: "listAccounts" },
    ]);
  });

  test("the analyzer accepts a repository function taking the context", () => {
    const good = `
      import type { HouseholdContext } from "@/platform/tenancy";
      export const findTransactions = async (
        context: HouseholdContext,
        month: string,
      ) => [];
      export function countAccounts(context: HouseholdContext) { return 0; }
    `;
    expect(analyzeAdapterSource(good, "good.ts")).toEqual([]);
  });
});
