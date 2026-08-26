import { PrismaClient } from "@prisma/client";
import { databaseUrlDiagnostic, isProduction } from "../config";
import { assessNonProductionDbTarget } from "./guard";
import { interlockApproval } from "./runtime-target";

// One PrismaClient per process. The dev server hot-reloads modules, so the
// instance is cached on globalThis outside production to avoid exhausting
// database connections.
//
// CONSTRUCTION IS LAZY, AND THAT IS THE SAFETY PROPERTY RATHER THAN A
// PERFORMANCE ONE (M3-P12 fix round ten, HAZARD finding CR9-M3P12-HZ-01).
//
// WHAT IT USED TO DO AND WHY IT WAS WRONG, stated rather than quietly changed
// (clause R-087). This module used to run its diagnostic, its guard and
// `new PrismaClient()` at MODULE SCOPE, so merely importing any repository
// constructed a client from whatever the ambient environment held. Measured in
// fix round nine: one `npm test` run printed the startup line below fourteen
// times from THIRTEEN distinct test files, and scripts/rederive-merchant-rules.ts
// printed it BEFORE its own target interlock spoke, because the interlock is
// called inside main() and the import graph is evaluated before that. The
// safety of both rested entirely on `new PrismaClient()` opening no socket,
// which is a property of a dependency that nothing in this tree asserted.
//
// Now nothing happens at import. The client is constructed on FIRST USE, which
// for every caller in this repository is behind whatever interlock that caller
// carries. The fast gate imports the adapters and issues no query, so it
// constructs nothing at all; a test below asserts that by counting the startup
// line, so this paragraph is a checked claim rather than a comment.
//
// THE ACCESSOR IS A PROXY so that every call site keeps reading
// `prisma.<model>.<method>()`. Six adapters and one route import this binding;
// making them all call a function would have been the same change written
// seven more times, and a call site that forgets is a call site that
// reintroduces eager construction.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Once per cold start, before the first query can fail on it: is DATABASE_URL
// present with a Postgres scheme? Prints nothing of the value beyond the
// scheme (deploy-verify diagnostics for criterion 0.6). It now runs at first
// use rather than at import, so it still precedes the first query and no
// longer fires in a process that never makes one.
const announce = (): void => {
  const diagnostic = databaseUrlDiagnostic();
  (diagnostic.ok ? console.log : console.error)(
    `[pulse:db] DATABASE_URL ${diagnostic.summary}`,
  );
};

// NOTHING OUTSIDE PRODUCTION MAY OPEN A TARGET NOBODY NAMED. See
// assessNonProductionDbTarget in ./guard for the contract and for why
// production is deliberately untouched, and ./runtime-target for why an
// interlock's own approval is honoured and an environment flag is not. This
// runs before the client is constructed, so a refused process opens nothing.
const assertTargetAllowed = (): void => {
  const verdict = assessNonProductionDbTarget({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    PULSE_ALLOW_REMOTE_DB_IN_DEV: process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV,
    interlockApproval: interlockApproval(),
  });
  if (!verdict.allowed) {
    console.error(`[pulse:db] ${verdict.reason}`);
    throw new Error(`[pulse:db] ${verdict.reason}`);
  }
};

// A constructor throw (typically a client that was never generated in this
// runtime) is logged with the same prefix and rethrown, so the failure is
// readable in the function logs instead of dying silently. The error text
// never includes the connection URL and none is added here.
const constructClient = (): PrismaClient => {
  announce();
  assertTargetAllowed();
  try {
    return new PrismaClient();
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "non-error";
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(
      `[pulse:db] PrismaClient construction failed: name=${name} message=${message}`,
    );
    throw cause;
  }
};

const client = (): PrismaClient => {
  const existing = globalForPrisma.prisma;
  if (existing !== undefined) {
    return existing;
  }
  const created = constructClient();
  if (!isProduction()) {
    globalForPrisma.prisma = created;
  }
  return created;
};

// EXPORTED WITH THE SAME TYPE AND THE SAME SHAPE AS BEFORE. Every property
// read constructs on demand and then delegates. Methods are bound to the real
// client so `prisma.$transaction(...)` and `prisma.account.create(...)` behave
// exactly as they did.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get: (_target, property, receiver) => {
    const value = Reflect.get(
      client() as unknown as object,
      property,
      receiver,
    ) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client())
      : value;
  },
  has: (_target, property) => property in (client() as unknown as object),
  getPrototypeOf: () => Object.getPrototypeOf(client() as unknown as object),
});

// TEST AND SCRIPT SEAM. A caller that must know whether a client has been
// constructed, or that wants to construct it deliberately at a point of its
// own choosing rather than at first property read, uses this.
export const prismaHasBeenConstructed = (): boolean =>
  globalForPrisma.prisma !== undefined;
