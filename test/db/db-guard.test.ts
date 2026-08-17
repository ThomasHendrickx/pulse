import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { assessDestructiveDbTarget } from "../../src/platform/db/guard";

// Fix round 1, finding CR-002 (hazard verdict): destructive db scripts must
// refuse to run unless the resolved target is the local stack. The pure
// assessment is tested directly; the process-level tests prove the CLI the
// npm scripts actually call exits nonzero on a foreign target, so the
// wiring, not only the function, is what is guarded.

const FOREIGN_POOLER =
  "postgresql://user:secret@aws-1-eu-north-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("assessDestructiveDbTarget", () => {
  test("refuses a foreign DATABASE_URL even when DIRECT_URL is local", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: LOCAL,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain("DATABASE_URL");
      expect(verdict.reason).toContain("aws-1-eu-north-1.pooler.supabase.com");
    }
  });

  test("refuses a foreign DIRECT_URL even when DATABASE_URL is local", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: LOCAL,
      DIRECT_URL: FOREIGN_POOLER,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain("DIRECT_URL");
    }
  });

  test("refuses when a connection string is missing (fail closed, no guessing)", () => {
    expect(assessDestructiveDbTarget({}).allowed).toBe(false);
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: LOCAL }).allowed,
    ).toBe(false);
  });

  test("refuses an unparseable connection string", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: "not a url at all",
      DIRECT_URL: LOCAL,
    });
    expect(verdict.allowed).toBe(false);
  });

  test("allows 127.0.0.1, localhost and ::1 targets", () => {
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL })
        .allowed,
    ).toBe(true);
    expect(
      assessDestructiveDbTarget({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
        DIRECT_URL: "postgresql://postgres:postgres@[::1]:54322/postgres",
      }).allowed,
    ).toBe(true);
  });

  test("allows a remote target only under the explicit override variable", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: FOREIGN_POOLER,
      PULSE_ALLOW_REMOTE_DB_DESTRUCTION: "1",
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("guard-cli process wiring", () => {
  const projectRoot = join(__dirname, "..", "..");
  const tsxBin = join(projectRoot, "node_modules", ".bin", "tsx");
  const cli = join(projectRoot, "src", "platform", "db", "guard-cli.ts");

  const runCli = (extraEnv: Record<string, string>) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PULSE_ALLOW_REMOTE_DB_DESTRUCTION: undefined,
      ...extraEnv,
    };
    return spawnSync(tsxBin, [cli], { env: env as NodeJS.ProcessEnv, cwd: projectRoot, encoding: "utf-8" });
  };

  test("exits nonzero when the environment points at a foreign host", () => {
    const result = runCli({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: FOREIGN_POOLER,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing");
  });

  test("exits zero when the environment points at the local stack", () => {
    const result = runCli({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL });
    expect(result.status).toBe(0);
  });
});
