import { PrismaClient } from "@prisma/client";
import { databaseUrlDiagnostic, isProduction } from "../config";
import { assessNonProductionDbTarget } from "./guard";
import { approvalSource, approvedConnection } from "./runtime-target";

// One PrismaClient per process, in EVERY environment including production,
// because more than one exhausts the database's connections. The dev server
// hot-reloads modules, so outside production the instance is ALSO cached on
// globalThis, which survives a module re-evaluation that a module-scope
// binding does not.
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
    interlockApproval: (() => {
      const connection = approvedConnection();
      const source = approvalSource();
      return connection === undefined || source === undefined
        ? undefined
        : { source, connection };
    })(),
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

// THE MEMOISATION IS THE MODULE-SCOPE BINDING, AND THE globalThis CACHE IS
// ONLY FOR HOT RELOAD (M3-P12 fix round twelve, CRITERIA finding
// CR11-M3P12-01).
//
// WHAT ROUND TEN SHIPPED AND WHY IT WAS A PRODUCTION DEFECT, quoted rather
// than quietly replaced (clause R-087). client() read `globalForPrisma.prisma`
// and wrote it back under `if (!isProduction())`. Outside production that
// memoises; INSIDE production nothing is ever written, so the read is always
// undefined and EVERY property access constructed a fresh PrismaClient. The
// old module got its once-per-process property for free, from being a
// module-level `const` that ES module semantics evaluate once whatever
// NODE_ENV holds; round ten removed eager construction and removed the
// singleton with it, in the one environment its tests never run in.
//
// MEASURED BY THE REVIEWER on the shipped code against a local stack: backends
// after four queries were 19, 20, 21, 22 under NODE_ENV=production and flat at
// 19 under NODE_ENV=test. Against a pooled deployed database that is
// connection exhaustion, in the environment where the owner's real money is on
// the other end.
//
// AND IT WAS TWICE PER READ, not once. The get trap called client() for
// Reflect.get and again for .bind(client()), so a single
// prisma.account.create(...) constructed TWO clients. The trap now resolves
// the client ONCE per read and binds to that same value.
//
// THE INVARIANT, pinned by test/db/client-singleton.test.ts under BOTH a
// production-like NODE_ENV and the test one: at most one construction per
// process, however many properties and methods are read.
let instance: PrismaClient | undefined;

const client = (): PrismaClient => {
  if (instance !== undefined) {
    return instance;
  }
  // The hot-reload cache, which survives a module re-evaluation that the
  // module-scope binding above does not. Production never writes it, so
  // production never reads a hit here; the binding above is what carries the
  // singleton there.
  const cached = globalForPrisma.prisma;
  if (cached !== undefined) {
    instance = cached;
    return instance;
  }
  instance = constructClient();
  if (!isProduction()) {
    globalForPrisma.prisma = instance;
  }
  return instance;
};

// EXPORTED WITH THE SAME TYPE AND THE SAME SHAPE AS BEFORE, and the traps are
// FAITHFUL rather than minimal (M3-P12 fix round twelve, HAZARD finding
// HZ11-M3P12-01 as amended).
//
// WHAT ROUND TEN'S PROXY GOT WRONG BESIDES THE COUNT, measured against a real
// client and recorded rather than discovered again: Object.keys went from 51
// to 0, JSON.stringify returned "{}" and constructed a client on the way,
// spread and for-in saw nothing, a write to the binding was silently
// swallowed where the real client round-trips, and
// `prisma.$transaction !== prisma.$transaction` because a fresh bound
// function was returned on every read. No consumer in src/ enumerates or
// writes today, so the reachable damage was the production storm; an unstable
// method identity nonetheless breaks any consumer that stores a handler or
// compares one, which is a defect waiting for its first caller.
//
// BOUND METHODS ARE CACHED PER CLIENT, so identity is stable for the life of
// the process and a handler stored once stays equal to itself. The cache is
// keyed on the property and lives beside the client it belongs to, so it
// cannot outlive it.
//
// THE ONE THING THAT CANNOT BE MADE FREE: any trap that must answer from the
// real client CONSTRUCTS it, enumeration included. So JSON.stringify or a
// spread of this binding in a process whose target is refused now throws the
// refusal rather than returning an empty object. That is the correct
// direction, and it is the price of laziness rather than an oversight.
const boundMethods = new WeakMap<object, Map<PropertyKey, unknown>>();

const bindOnce = (
  active: PrismaClient,
  property: PropertyKey,
  value: (...args: unknown[]) => unknown,
): unknown => {
  const owner = active as unknown as object;
  let cache = boundMethods.get(owner);
  if (cache === undefined) {
    cache = new Map<PropertyKey, unknown>();
    boundMethods.set(owner, cache);
  }
  const existing = cache.get(property);
  if (existing !== undefined) {
    return existing;
  }
  const bound = value.bind(active);
  cache.set(property, bound);
  return bound;
};

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get: (_target, property) => {
    const active = client();
    // The RECEIVER is the real client rather than the proxy: a getter on the
    // client must see its own instance as `this`, and passing the proxy would
    // re-enter this trap.
    const value = Reflect.get(
      active as unknown as object,
      property,
      active,
    ) as unknown;
    return typeof value === "function"
      ? bindOnce(active, property, value as (...args: unknown[]) => unknown)
      : value;
  },
  set: (_target, property, value) =>
    Reflect.set(client() as unknown as object, property, value),
  deleteProperty: (_target, property) =>
    Reflect.deleteProperty(client() as unknown as object, property),
  has: (_target, property) => property in (client() as unknown as object),
  ownKeys: () => Reflect.ownKeys(client() as unknown as object),
  getOwnPropertyDescriptor: (_target, property) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      client() as unknown as object,
      property,
    );
    // A proxy may only report a property as configurable-false if its own
    // target has it, and the target is an empty object, so every descriptor is
    // reported configurable. Without this, Object.keys throws a TypeError.
    return descriptor === undefined
      ? undefined
      : { ...descriptor, configurable: true };
  },
  getPrototypeOf: () => Object.getPrototypeOf(client() as unknown as object),
  defineProperty: (_target, property, descriptor) =>
    Reflect.defineProperty(client() as unknown as object, property, descriptor),
});

// TEST AND SCRIPT SEAM. A caller that must know whether a client has been
// constructed, or that wants to construct it deliberately at a point of its
// own choosing rather than at first property read, uses this.
//
// IT READS THE MODULE BINDING AND NOT THE globalThis CACHE, corrected in fix
// round twelve. Reading the cache made this predicate hard-false in
// production however many clients had been constructed, which is exactly the
// state the finding above describes, so the one seam that could have shown the
// defect was blind to it by construction.
export const prismaHasBeenConstructed = (): boolean => instance !== undefined;
