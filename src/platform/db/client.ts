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

// Construction happens AFTER the diagnostic above by statement order, and a
// constructor throw (typically a client that was never generated in this
// runtime) is logged with the same prefix and rethrown, so the failure is
// readable in the function logs instead of dying silently at import time.
// The error text never includes the connection URL and none is added here.
const constructClient = (): PrismaClient => {
  try {
    return new PrismaClient();
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "non-error";
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(
      `[pulse:db] PrismaClient construction failed at import time: name=${name} message=${message}`,
    );
    throw cause;
  }
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? constructClient();

if (!isProduction()) {
  globalForPrisma.prisma = prisma;
}
