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
