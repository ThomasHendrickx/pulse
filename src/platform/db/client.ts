import { PrismaClient } from "@prisma/client";
import { databaseUrlDiagnostic, isProduction } from "../config";

// One PrismaClient per process. The dev server hot-reloads modules, so the
// instance is cached on globalThis outside production to avoid exhausting
// database connections.

// Once per cold start, before the first query can fail on it: is
// DATABASE_URL present with a Postgres scheme? Prints nothing of the value
// beyond the scheme (deploy-verify diagnostics for criterion 0.6).
const diagnostic = databaseUrlDiagnostic();
(diagnostic.ok ? console.log : console.error)(
  `[pulse:db] DATABASE_URL ${diagnostic.summary}`,
);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (!isProduction()) {
  globalForPrisma.prisma = prisma;
}
