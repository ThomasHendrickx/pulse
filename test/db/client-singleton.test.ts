import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// M3-P12 FIX ROUND TWELVE, CRITERIA finding CR11-M3P12-01.
//
// THE DEFECT THIS FILE EXISTS TO MAKE IMPOSSIBLE, and the lesson is the first
// sentence rather than a footnote: A DEFECT THAT ONLY APPEARS UNDER ONE
// NODE_ENV IS INVISIBLE TO A SUITE THAT ONLY EVER RUNS UNDER ANOTHER. Every
// test in this repository runs under vitest, where NODE_ENV is "test". Round
// ten made the application client lazy and, in the same change, memoised it
// only under `if (!isProduction())`. Outside production that is a singleton;
// INSIDE production nothing was ever memoised, so every property read
// constructed a fresh PrismaClient. Ten rounds of a green fast gate could not
// see it, because the fast gate never leaves NODE_ENV=test.
//
// Measured by the reviewer on the shipped code against a local stack: database
// backends after four queries were 19, 20, 21, 22 under NODE_ENV=production
// and flat at 19 under NODE_ENV=test. Against a pooled deployed database that
// is connection exhaustion, in the one environment where the owner's real
// money is on the other end.
//
// AND IT WAS TWO PER READ, not one: the proxy's get trap called the resolver
// once for Reflect.get and again to bind the method, so a single
// prisma.account.create(...) constructed TWO clients.
//
// SO EVERY CASE BELOW RUNS UNDER BOTH ENVIRONMENTS, from one table, and the
// production row is the one that would have gone red. The PrismaClient itself
// is replaced by a counting stub: what is under test is how many times the
// module constructs one, which is exactly the invariant, and no real client
// and no connection is involved.

const counter = vi.hoisted(() => ({ constructions: 0 }));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    // Two model-shaped properties and two method-shaped ones, so the test can
    // read both kinds through the proxy.
    public readonly account = { create: () => "created" };
    public readonly merchantRule = { findMany: () => [] };
    public constructor() {
      counter.constructions += 1;
    }
    public $queryRaw(): number {
      return 1;
    }
    public $transaction(): number {
      return 1;
    }
    public $disconnect(): void {}
  },
}));

type ClientModule = typeof import("../../src/platform/db/client");

const ENVIRONMENTS = ["production", "test", undefined] as const;

// NODE_ENV is typed readonly by @types/node, and this file's whole subject is
// what the module does under a DIFFERENT one, so the write goes through a
// mutable view of the same object rather than through a cast at each site.
const mutableEnv = process.env as Record<string, string | undefined>;

const setNodeEnv = (value: string | undefined): void => {
  if (value === undefined) {
    delete mutableEnv["NODE_ENV"];
  } else {
    mutableEnv["NODE_ENV"] = value;
  }
};

describe("the application client is constructed AT MOST ONCE per process, in every environment", () => {
  let previousNodeEnv: string | undefined;
  let previousDatabaseUrl: string | undefined;

  // INVENTED, and local, because the non-production guard beside this one
  // refuses a non-local target and this container's ambient value is a
  // deployed pooler. What is under test here is HOW MANY clients are
  // constructed, not which target they would open; the target guard has its
  // own tests in test/db/db-guard.test.ts. No connection is made either way:
  // PrismaClient is a counting stub in this file.
  const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = LOCAL_DATABASE_URL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setNodeEnv(previousNodeEnv);
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    vi.restoreAllMocks();
  });

  // A FRESH MODULE INSTANCE PER CASE. The module memoises in a module-scope
  // binding, so a case that reused the registry would measure the previous
  // case's client. The globalThis hot-reload cache survives a module reset by
  // design, so it is cleared too.
  const freshModule = async (nodeEnv: string | undefined): Promise<ClientModule> => {
    setNodeEnv(nodeEnv);
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.resetModules();
    counter.constructions = 0;
    return import("../../src/platform/db/client");
  };

  for (const nodeEnv of ENVIRONMENTS) {
    const label = nodeEnv ?? "unset";

    test(`NODE_ENV=${label}: importing constructs nothing`, async () => {
      const clientModule = await freshModule(nodeEnv);
      expect(counter.constructions).toBe(0);
      expect(clientModule.prismaHasBeenConstructed()).toBe(false);
    });

    test(`NODE_ENV=${label}: many property and method reads construct EXACTLY ONE client`, async () => {
      const clientModule = await freshModule(nodeEnv);

      // Four model-property reads and four method reads, which is the shape
      // every adapter call site in src/modules uses.
      const first = clientModule.prisma.account;
      const second = clientModule.prisma.account;
      const third = clientModule.prisma.merchantRule;
      const fourth = clientModule.prisma.merchantRule;
      const raw = clientModule.prisma.$queryRaw;
      const transaction = clientModule.prisma.$transaction;
      void clientModule.prisma.$queryRaw;
      void clientModule.prisma.$transaction;

      // THE ASSERTION THE DEFECT WOULD HAVE FAILED. On the shipped code this
      // read EIGHT under production: one construction per property read, and
      // two per METHOD read because the trap resolved the client twice.
      expect(counter.constructions).toBe(1);

      // AND THE SAME OBJECT COMES BACK, which is the property a caller
      // actually depends on. Under the defect two reads of one model returned
      // two different objects belonging to two different clients.
      expect(first).toBe(second);
      expect(third).toBe(fourth);
      expect(typeof raw).toBe("function");
      expect(typeof transaction).toBe("function");

      // The seam is honest in every environment. It used to read the
      // globalThis cache, which production never writes, so it was hard-false
      // there however many clients existed.
      expect(clientModule.prismaHasBeenConstructed()).toBe(true);
    });

    test(`NODE_ENV=${label}: calling a method through the proxy adds no further construction`, async () => {
      const clientModule = await freshModule(nodeEnv);
      // The stub's signatures are narrower than the real client's, so the
      // calls go through an untyped view. What is under test is the
      // construction count, not the query types.
      const loose = clientModule.prisma as unknown as {
        account: { create: () => string };
        $queryRaw: () => number;
      };
      expect(loose.account.create()).toBe("created");
      expect(loose.$queryRaw()).toBe(1);
      expect(loose.account.create()).toBe("created");
      expect(counter.constructions).toBe(1);
    });

    // IDENTITY IS STABLE (HAZARD finding HZ11-M3P12-01 as amended). Round ten
    // returned a fresh bound function on every read, so
    // prisma.$transaction !== prisma.$transaction, which breaks any consumer
    // that stores a handler or compares one. Methods are now bound once per
    // client.
    test(`NODE_ENV=${label}: a method read twice is the SAME function`, async () => {
      const clientModule = await freshModule(nodeEnv);
      expect(clientModule.prisma.$transaction).toBe(clientModule.prisma.$transaction);
      expect(clientModule.prisma.$queryRaw).toBe(clientModule.prisma.$queryRaw);
      expect(counter.constructions).toBe(1);
    });

    // AND THE BINDING IS ENUMERABLE AND WRITABLE, which round ten's minimal
    // trap set was not: Object.keys returned nothing, JSON.stringify returned
    // an empty object, and a write was silently swallowed.
    test(`NODE_ENV=${label}: the binding enumerates and round-trips a write like the client it wraps`, async () => {
      const clientModule = await freshModule(nodeEnv);
      expect(Object.keys(clientModule.prisma)).toContain("account");
      expect(Object.keys(clientModule.prisma)).toContain("merchantRule");
      expect({ ...clientModule.prisma }).toHaveProperty("account");
      const writable = clientModule.prisma as unknown as Record<string, unknown>;
      writable["marker"] = 7;
      expect(writable["marker"]).toBe(7);
      expect(counter.constructions).toBe(1);
    });
  }

  // THE CONTROL, so the three cases above are a measurement and not a stub
  // that never constructs at all.
  test("THE CONTROL: two separate module instances construct two clients, so the counter counts", async () => {
    await freshModule("production");
    void (await import("../../src/platform/db/client")).prisma.account;
    const afterFirst = counter.constructions;
    await freshModule("production");
    void (await import("../../src/platform/db/client")).prisma.account;
    expect(afterFirst).toBe(1);
    expect(counter.constructions).toBe(1);
  });
});
