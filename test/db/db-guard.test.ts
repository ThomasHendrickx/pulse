import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { assessDestructiveDbTarget } from "../../src/platform/db/guard";
import { resolveDbEnv } from "../../src/platform/db/resolve-env";

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

// M3-P12 FIX ROUND FOUR, CRITERIA finding CR4-M3P12-01.
//
// src/platform/db/resolve-env.ts used to claim, as a present-tense fact about
// another program, that the Prisma CLI falls back to .env for a variable the
// shell carries as the EMPTY STRING. It does not. Criterion 12.23 repeats the
// same sentence, and the criterion's word "decorative" rests on it, so the
// asymmetry is pinned here rather than left as a corrected paragraph nothing
// checks. Both halves are executed: what the CLI does, and what this tree's
// resolver does.
describe("the guard's reading and the Prisma CLI's differ on the EMPTY case, and the guard is the stricter one", () => {
  const projectRoot = join(__dirname, "..", "..");
  const LOCAL_FROM_DOT_ENV =
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  // A throwaway package root: its own schema and its own .env, so nothing
  // here depends on whether this checkout has a .env or what is in it.
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-env-asymmetry-"));
    writeFileSync(
      join(dir, "schema.prisma"),
      [
        "generator client {",
        '  provider = "prisma-client-js"',
        "}",
        "datasource db {",
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '  directUrl = env("DIRECT_URL")',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, ".env"),
      `DATABASE_URL="${LOCAL_FROM_DOT_ENV}"\nDIRECT_URL="${LOCAL_FROM_DOT_ENV}"\n`,
    );
    return dir;
  };

  const validate = (overrides: Record<string, string | undefined>) => {
    const dir = scratch();
    const env: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
      ...overrides,
    };
    return spawnSync(
      join(projectRoot, "node_modules", ".bin", "prisma"),
      ["validate", "--schema", join(dir, "schema.prisma")],
      { env: env as NodeJS.ProcessEnv, cwd: dir, encoding: "utf-8" },
    );
  };

  test("THE CLI: an ABSENT variable falls back to .env, which is the half that is true", () => {
    const result = validate({});
    expect(result.status).toBe(0);
  });

  test("THE CLI: a shell-EMPTY variable does NOT fall back; it aborts. This is the sentence that was false", () => {
    const result = validate({ DATABASE_URL: "" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("empty string");
  });

  test("THE GUARD: a shell-EMPTY variable IS treated as absent, so it falls back where the CLI aborts", () => {
    const dir = scratch();
    const previousCwd = process.cwd();
    const previous = process.env["DATABASE_URL"];
    try {
      process.chdir(dir);
      process.env["DATABASE_URL"] = "";
      expect(resolveDbEnv("DATABASE_URL")).toBe(LOCAL_FROM_DOT_ENV);
      delete process.env["DATABASE_URL"];
      expect(resolveDbEnv("DATABASE_URL")).toBe(LOCAL_FROM_DOT_ENV);
    } finally {
      process.chdir(previousCwd);
      if (previous === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = previous;
      }
    }
  });

  // WHY THE DIVERGENCE IS SAFE, executed rather than argued. The divergence
  // exists only for a shell-EMPTY value, and in that case the command the
  // guard protects aborts before opening anything. So the guard either
  // approves a target the command never reaches, or refuses and the command
  // never runs. It is stricter than its subject in both directions, which is
  // the only direction a fail-closed interlock may err in.
  test("THE CONSEQUENCE: the empty case can only make the guard refuse a run the CLI would have aborted anyway", () => {
    const foreign =
      "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    // What the guard sees when the shell carries empty and .env carries a
    // foreign target: it resolves the .env value and REFUSES.
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: foreign, DIRECT_URL: foreign })
        .allowed,
    ).toBe(false);
    // And the empty string itself is refused outright, never read as a host.
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: "", DIRECT_URL: "" }).allowed,
    ).toBe(false);
  });
});
