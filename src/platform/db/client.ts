import { PrismaClient } from "@prisma/client";
import { databaseUrlDiagnostic, isProduction } from "../config";
import { assessDevServerDbTarget } from "./guard";

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

// A NON-PRODUCTION SERVER MAY NOT OPEN A DEPLOYED DATABASE (M3-P12 fix round
// five, hazard finding HAZ5-3). See assessDevServerDbTarget in ./guard for the
// contract and for why production is deliberately untouched. This runs before
// the client is constructed, so a refused dev server opens nothing at all.
const devTarget = assessDevServerDbTarget({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  PULSE_ALLOW_REMOTE_DB_IN_DEV: process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV,
});
if (!devTarget.allowed) {
  console.error(`[pulse:db] ${devTarget.reason}`);
  throw new Error(`[pulse:db] ${devTarget.reason}`);
}

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
