import { assessDestructiveDbTarget, type DbGuardEnv } from "./guard";
import { resolveDbEnv } from "./resolve-env";

// CLI wrapper around the destructive-database interlock; see guard.ts for
// the contract. Run by db:reset, db:migrate and rederive:merchant-rules
// BEFORE the command each of those guards.
//
// Environment resolution mirrors Prisma's and lives in ONE place: see
// resolve-env.ts for the reading and for why a shell variable carrying the
// empty string falls back. EXTRACTED IN M3-P12's SECOND FIX ROUND under
// criterion 12.23, which requires an interlock to resolve the way the
// command it guards resolves; two copies that agree today is not that. This
// file guards Prisma CLI commands, so it imports resolveDbEnv, the CLI's
// shell-first, dot-env-fallback reading; the re-derivation routine guards a
// client construction, so it imports resolveClientDbUrl from the SAME module
// (finding CR3-M3P12-03, pinned by finding R2-M0P14-03).

const resolved = resolveDbEnv;

const env: DbGuardEnv = {
  DATABASE_URL: resolved("DATABASE_URL"),
  DIRECT_URL: resolved("DIRECT_URL"),
  PULSE_ALLOW_REMOTE_DB_DESTRUCTION: process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION,
};

const verdict = assessDestructiveDbTarget(env);

if (verdict.allowed) {
  console.log(`db guard: ${verdict.reason}`);
  process.exit(0);
}

console.error(`db guard: ${verdict.reason}`);
process.exit(1);
