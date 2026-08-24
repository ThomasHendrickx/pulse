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
// THE READING, and the case the two obvious readings differ on. The PRISMA
// CLI takes a variable from the shell when the shell carries it, and falls
// back to the .env file at the package root otherwise. A variable the shell
// carries as the EMPTY STRING falls back too: an empty DATABASE_URL is not a
// connection string, and treating it as one would make an interlock refuse a
// target the command would happily open, or approve one it would not.
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

export const resolveDbEnv = (name: string): string | undefined =>
  process.env[name] !== undefined && process.env[name] !== ""
    ? process.env[name]
    : dotEnvFallback(name);

// WHAT `new PrismaClient()` WILL SEE, exactly: process.env and no fallback.
// An interlock in front of a tsx entry point reads THIS, so the string it
// checks is by construction the string the client opens.
export const resolveClientDbUrl = (): string | undefined => {
  const value = process.env["DATABASE_URL"];
  return value === undefined || value === "" ? undefined : value;
};
