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
// THE READING, and the case the two obvious readings differ on. Prisma takes
// a variable from the shell when the shell carries it, and falls back to the
// .env file at the package root otherwise. A variable the shell carries as
// the EMPTY STRING falls back too: an empty DATABASE_URL is not a connection
// string, and treating it as one would make an interlock refuse a target the
// command would happily open, or approve one it would not.
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
