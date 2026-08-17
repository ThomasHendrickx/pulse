import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assessDestructiveDbTarget, type DbGuardEnv } from "./guard";

// CLI wrapper around the destructive-database interlock; see guard.ts for
// the contract. Run by db:reset and db:migrate BEFORE any prisma command.
//
// Environment resolution mirrors Prisma's: a variable set in the shell wins,
// and only a variable missing from the shell falls back to the .env file at
// the package root. Reading process.env directly here is deliberate (the
// one exemption beside src/platform/config.ts): the guard must see exactly
// the environment the prisma command after it will see.

const dotEnvFallback = (name: string): string | undefined => {
  const dotEnvPath = join(process.cwd(), ".env");
  if (!existsSync(dotEnvPath)) {
    return undefined;
  }
  for (const line of readFileSync(dotEnvPath, "utf-8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === name && match[2] !== undefined) {
      return match[2].replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
};

const resolved = (name: string): string | undefined =>
  process.env[name] !== undefined && process.env[name] !== ""
    ? process.env[name]
    : dotEnvFallback(name);

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
