// HOW A DATABASE VARIABLE IS RESOLVED, in ONE place (M3-P12 fix round two,
// criterion 12.23).
//
// WHY THIS FILE EXISTS AT ALL. Two interlocks in this directory must see
// exactly the environment the command they guard will see, and criterion
// 12.23 says why that has to be structural rather than asserted: "an
// interlock that resolves differently from the command it guards is
// decorative". guard-cli.ts implemented this reading inline and the target
// interlock needed the same one, so the choice was one implementation or two
// copies that agree until somebody edits one. This is the one.
//
// THE READING, and the case the two obvious readings differ on.
//
// CORRECTED IN M3-P12'S FOURTH FIX ROUND, CRITERIA finding CR4-M3P12-01, and
// LOUDLY because the sentence that stood here was a present-tense claim about
// another program's behaviour and it was FALSE. It said: "A variable the
// shell carries as the EMPTY STRING falls back too." It does not. Witnessed
// against the pinned Prisma CLI 6.19.3 in this tree: with a .env at the
// package root carrying both variables, `env -u DIRECT_URL DATABASE_URL=""
// npx prisma validate` loaded the .env file and then failed with "You must
// provide a nonempty URL. The environment variable `DATABASE_URL` resolved to
// an empty string." The control run, with the variable ABSENT rather than
// empty, validated cleanly. So the fallback for an absent variable is real
// and the fallback for an empty one is not.
//
// WHAT IS ACTUALLY TRUE. The PRISMA CLI takes a variable from the shell when
// the shell carries it AT ALL, empty included, and falls back to the .env
// file in the CURRENT WORKING DIRECTORY only when the shell does not carry it.
// See the note on readDotEnvValue below for why that is the location and not
// the package root. resolveDbEnv
// below deliberately treats a shell-EMPTY value as ABSENT, so it falls back
// where the CLI would abort.
//
// WHY THAT DIVERGENCE IS SAFE, checked in both directions rather than
// asserted, because criterion 12.23's word "decorative" rests on it. The
// divergence can only arise when the shell carries an EMPTY value, and in
// that case the CLI aborts before touching any database. Either the guard
// resolves a .env value and approves, and the command it guards then aborts
// on the empty string having opened nothing; or the guard resolves a .env
// value and REFUSES, and the command never runs. Neither direction lets a
// command reach a target the guard did not check. The guard is STRICTER than
// the command, which is the direction a fail-closed interlock must err in.
// test/db/db-guard.test.ts pins this asymmetry so the paragraph stops being a
// claim nothing checks.
//
// THIS IS A PLAN DEFECT TOO, reported and not papered over: criterion 12.23
// repeats the false sentence, requiring the guard to read ".env only for a
// variable the shell does not carry OR carries empty, which is the resolution
// guard-cli.ts already implements". The two readings are not equivalent and
// the criterion should state the asymmetry above. Routing that is the
// orchestrator's; the code says what is true in the meantime.
//
// THIS IS THE CLI'S READING AND NOT THE CLIENT'S, corrected in M3-P12's third
// fix round under finding CR3-M3P12-03 because the sentence above used to say
// "Prisma" flatly and a reader would take it for both. `new PrismaClient()`
// reads process.env and NOTHING else: nothing in this tree loads dotenv, and
// the npm scripts add no env loading. So:
//
//   resolveDbEnv    matches the PRISMA CLI, and guards prisma migrate reset
//                   and prisma migrate dev, which is what guard-cli.ts does.
//
//   resolveClientDbUrl matches the CLIENT, and is what an interlock in front
//                   of a tsx entry point must use, because that is the string
//                   the connection will actually be opened from.
//
// Using the CLI reading in front of a tsx entry point would let the interlock
// approve a target read out of .env while the routine opens a different
// connection or none at all.
//
// READING process.env DIRECTLY IS DELIBERATE HERE, and is the one exemption
// beside src/platform/config.ts, for the reason above: this must be the raw
// environment and not a validated view of it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// EXPORTED as readDotEnvValue in M3-P12's fourth fix round: the gate
// interlock (gate-target.ts) must read the .env file DIRECTLY rather than
// through a loader that declines to override a shell variable, and this is
// the reader this tree already has.
//
// IT READS THE WORKING DIRECTORY, NOT THE PACKAGE ROOT, and every comment in
// this directory used to say the package root (fix round nine, CRITERIA
// finding CR7-M3P12-06). The old sentence is quoted rather than deleted
// (clause R-087): "the .env file at the package root". The two are the same
// only when the command is invoked from the package root, which every npm
// script in this repository is, so nothing sanctioned was ever wrong; but the
// operator instructions in gate-target.ts told a person to create a file at a
// location the code does not read, and a present-tense claim about behaviour
// that nothing checks is exactly what clause R-087 names.
//
// THE WORKING DIRECTORY IS THE CORRECT READING AND NOT A BUG TO FIX. The
// Prisma CLI resolves its own .env relative to the invocation, so an interlock
// resolving from its own module location would diverge from the command it
// guards the moment the two differ, and criterion 12.23 calls an interlock
// that resolves differently from its command decorative. The failure
// direction of the working-directory reading is a REFUSAL: invoked from a
// subdirectory the gate finds no target and throws GateDbTargetRefused, which
// is a round trip rather than a run against something nobody named.
//
// test/db/db-guard.test.ts pins WHICH of the two locations is meant, so the
// paragraph above is a checked claim rather than a comment.
export const readDotEnvValue = (name: string): string | undefined => {
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

export const resolveDbEnv = (name: string): string | undefined =>
  process.env[name] !== undefined && process.env[name] !== ""
    ? process.env[name]
    : readDotEnvValue(name);

// WHAT `new PrismaClient()` WILL SEE, exactly: process.env and no fallback.
// An interlock in front of a tsx entry point reads THIS, so the string it
// checks is by construction the string the client opens.
export const resolveClientDbUrl = (): string | undefined => {
  const value = process.env["DATABASE_URL"];
  return value === undefined || value === "" ? undefined : value;
};
