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
// WHY IT IS NOW "NOT PRODUCTION" AND NOT "EXACTLY development", CORRECTED IN
// FIX ROUND TEN under HAZARD finding CR9-M3P12-HZ-01, and the old reasoning is
// quoted rather than deleted because it was careful and it was still wrong
// (clause R-087).
//
// WHAT STOOD HERE: that "development" is precisely the command the gap is
// about, and that "not production" is wider in two ways that are both wrong,
// because it catches NODE_ENV=test, "and the fast gate transitively imports
// this module, so the wider form made `npm test` refuse to run in any
// container whose ambient DATABASE_URL is remote"; and because it catches
// NODE_ENV unset, "which is what a tsx entry point has, including the
// re-derivation command, whose whole purpose is to open a DEPLOYED database".
// It ended: "What remains unguarded by this is an arbitrary tsx entry point
// with no NODE_ENV, which is the status quo and a different question."
//
// WHY THAT WAS WRONG. It was not wrong about the two costs; it was wrong that
// they were unavoidable, and it left the guard inert in exactly the two
// contexts where this module is actually reached. Measured in fix round nine:
// one `npm test` run printed the client's own startup line fourteen times from
// thirteen distinct test files, and the re-derivation command constructed a
// client from the ambient environment BEFORE its own interlock spoke. So "a
// test run or a script is not the thing this guard is about" described the
// only two things it was ever reached by.
//
// WHAT MAKES THE WIDER FORM AFFORDABLE NOW, and it is a change to the client
// rather than an argument: src/platform/db/client.ts constructs LAZILY. The
// fast gate imports the adapters and never issues a query, so no client is
// constructed and this predicate is never consulted, which removes the first
// cost entirely rather than trading it away. And the re-derivation reaches
// construction only through a repository call, which happens after its own
// interlock has proved host and ref, which removes the second: that interlock
// records its approval in ./runtime-target and this predicate honours it.
//
// THE PREDICATE IS NOW: production is untouched; an interlock that has already
// named and matched this process's target is honoured; otherwise a present
// connection string must name a local host, with the one explicit override
// below.
//
// THE OVERRIDE KEEPS ITS NAME, PULSE_ALLOW_REMOTE_DB_IN_DEV, though it now
// covers every non-production context rather than the dev server alone. The
// name is retained deliberately: it is an operator-facing variable that
// standing instructions already name, and renaming it would break those
// instructions to make one comment read better.
export type NonProductionDbGuardEnv = {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly PULSE_ALLOW_REMOTE_DB_IN_DEV?: string | undefined;
  // AN APPROVAL IS A PAIR, NOT A NAME (fix round twelve, CRITERIA finding
  // CR11-M3P12-04). What used to be here was the NAME of an interlock, and
  // presence alone admitted any target, so an approval obtained for one
  // database admitted a different one and a caller that had resolved nothing
  // could produce it. The approval now carries the exact connection string an
  // interlock re-verified, and this predicate admits only when the connection
  // it is being asked about IS that one.
  readonly interlockApproval?:
    | { readonly source: string; readonly connection: string }
    | undefined;
};

export const assessNonProductionDbTarget = (
  env: NonProductionDbGuardEnv,
): DbGuardVerdict => {
  if (env.NODE_ENV === "production") {
    return {
      allowed: true,
      reason:
        "production: this is the server that serves real traffic and the deployed database is the target it exists to open",
    };
  }
  const approval = env.interlockApproval;
  if (approval !== undefined) {
    // THE COMPARISON IS THE POINT. Presence used to be enough, so the guard
    // skipped its host check without re-establishing what was being opened.
    if (
      env.DATABASE_URL !== undefined &&
      env.DATABASE_URL !== "" &&
      env.DATABASE_URL === approval.connection
    ) {
      return {
        allowed: true,
        reason: `${approval.source} resolved THIS connection and matched it against a host and project ref named on its own command line`,
      };
    }
    // An approval for a different connection is not an approval for this one,
    // and saying so is more useful than falling silently through to the host
    // check, which would refuse with a reason about ambient values.
    return {
      allowed: false,
      reason: `an interlock approval recorded by ${approval.source} exists in this process, but it names a DIFFERENT connection from the one about to be opened. Refusing: an approval is a statement about one database. The resolved values are deliberately not printed: this repository is public.`,
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
        "DATABASE_URL did not parse as a connection URL, so a non-production process cannot establish what it would open. Refusing.",
    };
  }
  if (!LOCAL_DB_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase())) {
    return {
      allowed: false,
      reason:
        "this process is not production and DATABASE_URL points at a non-local host. Refusing to open it: nothing outside production serves real traffic, and in a shared container the ambient value belongs to somebody else's deployment. Pin DATABASE_URL to the local stack, run the command that carries its own host-and-ref interlock, or set PULSE_ALLOW_REMOTE_DB_IN_DEV=1 for a deliberate remote session. The resolved value is deliberately not printed: this repository is public.",
    };
  }
  return {
    allowed: true,
    reason: "non-production and DATABASE_URL targets the local stack",
  };
};
