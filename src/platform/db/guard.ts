// Destructive-database interlock (fix round 1, finding CR-002).
//
// CONTRACT OF THIS GUARD, stated at the mechanism's definition: the npm
// scripts that can destroy database state (db:reset, which drops the schema,
// and db:migrate, which can reset on drift) run guard-cli.ts first, and the
// guard refuses to proceed unless BOTH resolved connection strings point at
// a local host (127.0.0.1, localhost or ::1). The refusal is fail closed: a
// missing or unparseable connection string refuses rather than guesses. The
// ONE deliberate escape hatch is PULSE_ALLOW_REMOTE_DB_DESTRUCTION=1, set
// explicitly per run by someone who means to destroy a remote database.
// This matters because shell environments in shared fleets have been
// observed carrying a FOREIGN deployed pooler in DATABASE_URL, and shell env
// overrides .env for Prisma, so an unguarded `prisma migrate reset --force`
// resolves to whatever the shell happens to hold.
//
// Sibling reader note: there is no other destructive db entry point in this
// repository today; anyone adding one (a script invoking prisma migrate
// reset, db push --force-reset, or raw DROP statements) must route it
// through this same guard.

export type DbGuardEnv = {
  readonly DATABASE_URL?: string | undefined;
  readonly DIRECT_URL?: string | undefined;
  readonly PULSE_ALLOW_REMOTE_DB_DESTRUCTION?: string | undefined;
};

export type DbGuardVerdict =
  | { readonly allowed: true; readonly reason: string }
  | { readonly allowed: false; readonly reason: string };

// EXPORTED so the gate interlock beside this one (gate-target.ts, M3-P12 fix
// round four) asks the same question of a hostname that this guard asks.
// One list, not two that agree until somebody edits one.
export const LOCAL_DB_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
]);

const LOCAL_HOSTS = LOCAL_DB_HOSTS;

const CHECKED_VARIABLES = ["DATABASE_URL", "DIRECT_URL"] as const;

export const assessDestructiveDbTarget = (env: DbGuardEnv): DbGuardVerdict => {
  if (env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION === "1") {
    return {
      allowed: true,
      reason:
        "PULSE_ALLOW_REMOTE_DB_DESTRUCTION=1 is set: the remote-target interlock is explicitly overridden for this run",
    };
  }

  for (const name of CHECKED_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === "") {
      return {
        allowed: false,
        reason: `${name} is not set; refusing to run a destructive database command against an unknown target`,
      };
    }

    let hostname: string;
    try {
      hostname = new URL(value).hostname;
    } catch {
      return {
        allowed: false,
        reason: `${name} did not parse as a connection URL; refusing to run a destructive database command against it`,
      };
    }

    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!LOCAL_HOSTS.has(normalized)) {
      return {
        allowed: false,
        reason: `${name} points at non-local host "${hostname}"; refusing to run a destructive database command against it. Set PULSE_ALLOW_REMOTE_DB_DESTRUCTION=1 only for a deliberate remote reset.`,
      };
    }
  }

  return { allowed: true, reason: "both connection strings target the local stack" };
};

// THE DEV SERVER'S OWN TARGET (M3-P12 fix round five, hazard finding HAZ5-3).
//
// WHAT THIS CLOSES. Until this round the work history recorded, as an open
// question, that `npm run dev` and `npx next start` both resolve DATABASE_URL
// from the ambient environment with no refusal, and rested that on "the
// deployed app must open a deployed database, so a local-only refusal would
// be wrong". That argument is true of `next start` and false of `next dev`,
// and conflating them left the live gap open: `next dev` never serves real
// production traffic, and in a fleet container the ambient DATABASE_URL is a
// DEPLOYED project belonging to somebody, with a working password. A
// developer who starts the dev server without pinning anything gets a local
// looking app writing to it.
//
// THE PREDICATE IS THREE THINGS AND NOTHING ELSE: NODE_ENV is exactly
// "development", a connection string is present, and its host is not local.
//
// WHY EXACTLY "development" AND NOT "not production", which is what the
// finding's concrete-fix proposed and what I built first. `next dev` sets
// NODE_ENV=development and `next start` sets production, so "development" is
// precisely the command the gap is about. "Not production" is wider in two
// ways that are both wrong here. It catches NODE_ENV=test, which is what
// vitest sets, and the fast gate transitively imports this module, so the
// wider form made `npm test` refuse to run in any container whose ambient
// DATABASE_URL is remote: that changes what the fast gate requires of every
// contributor, to guard a server the fast gate never starts. And it catches
// NODE_ENV unset, which is what a tsx entry point has, including the
// re-derivation command, whose whole purpose is to open a DEPLOYED database
// and which carries its own stricter interlock in target-guard.ts; the wider
// form would have refused the one command criterion 12.23 exists for.
//
// So this guards the dev server and nothing else. Production is untouched,
// tests are untouched, and the writing script keeps the interlock built for
// it. What remains unguarded by this is an arbitrary tsx entry point with no
// NODE_ENV, which is the status quo and a different question.
//
// THE ESCAPE HATCH mirrors the destructive guard's above, in name and in
// posture: one variable, set explicitly per run by someone who means to point
// a dev server at a remote database. It is not read anywhere else.
export type DevDbGuardEnv = {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly PULSE_ALLOW_REMOTE_DB_IN_DEV?: string | undefined;
};

export const assessDevServerDbTarget = (env: DevDbGuardEnv): DbGuardVerdict => {
  if (env.NODE_ENV !== "development") {
    return {
      allowed: true,
      reason:
        "not a development server: production opens the deployed database, and a test run or a script is not the thing this guard is about",
    };
  }
  if (env.PULSE_ALLOW_REMOTE_DB_IN_DEV === "1") {
    return {
      allowed: true,
      reason:
        "PULSE_ALLOW_REMOTE_DB_IN_DEV=1 is set: the non-production remote-target interlock is explicitly overridden for this run",
    };
  }
  const value = env.DATABASE_URL;
  if (value === undefined || value === "") {
    // NOT this guard's business. A missing connection string is the client's
    // own error and it says so clearly; refusing here would replace a precise
    // message with a vaguer one.
    return { allowed: true, reason: "no DATABASE_URL is set; nothing to check" };
  }
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return {
      allowed: false,
      reason:
        "DATABASE_URL did not parse as a connection URL, so a non-production server cannot establish what it would open. Refusing.",
    };
  }
  if (!LOCAL_DB_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase())) {
    return {
      allowed: false,
      reason:
        "this is a development server and DATABASE_URL points at a non-local host. Refusing to open it: a development server is never the thing that serves real traffic, and in a shared container the ambient value belongs to somebody else's deployment. Pin DATABASE_URL to the local stack, or set PULSE_ALLOW_REMOTE_DB_IN_DEV=1 for a deliberate remote session. The resolved value is deliberately not printed: this repository is public.",
    };
  }
  return {
    allowed: true,
    reason: "non-production and DATABASE_URL targets the local stack",
  };
};
