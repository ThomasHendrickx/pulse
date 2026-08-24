// THE GATE'S DATABASE TARGET, decided by this repository rather than by
// whatever the shell happens to hold (M3-P12 fix round four, finding
// CRITERIA finding CR4-M3P12-02).
//
// THE RULE THIS FILE ENFORCES: no test, no script and no gate in this
// repository may open a database nobody named.
//
// WHAT WENT WRONG. This phase added test/e2e/merchant-rule-write.spec.ts,
// whose whole content is direct writes through `new PrismaClient()`. That
// constructor reads process.env and nothing else, so the spec's target was
// whatever DATABASE_URL the invoking shell carried. In this fleet's
// containers that value is a DEPLOYED pooler belonging to a different
// project, with a working password. The two web servers had the same hole
// from the other direction: playwright.config.ts spread `...process.env` into
// both of them, and Next's own loader does not override a variable the shell
// already carries, so a .env file at the package root was not a pin. The
// plan names this exact shape as hazard H12.30 and criterion 12.23 bought a
// guard for ONE command; this is the guard for the gate.
//
// WHY IT IS A REFUSAL AND NOT A DEFAULT. An instruction to export the right
// variables before running the suite is not a mechanism; the reviewer who
// found this had to discover the pin by watching every app spec fail. So the
// gate resolves its target from sources that exist to NAME it, checks that
// what it found is a local stack, and REFUSES the run otherwise. There is no
// override flag: a gate that may be pointed at a deployed database on request
// is a gate that will be.
//
// THE RESOLUTION ORDER, and why the ambient DATABASE_URL is not in it:
//
//   1. PULSE_GATE_DATABASE_URL and its siblings. These names exist for one
//      purpose, so a value under one of them was put there on purpose. This
//      is how an operator points the gate at a database they made.
//
//   2. The .env file at the package root, read directly rather than through
//      a loader that declines to override. This is the ordinary local case.
//
//   3. Nothing. Refuse.
//
// The shell's DATABASE_URL is DELIBERATELY NOT CONSULTED. It is the variable
// that is ambient in this fleet, which is another way of saying it is the one
// variable nobody named for this purpose. Once a target is approved it is
// ASSIGNED into process.env, so the Playwright workers, the two web servers
// and every client any of them constructs open the same named string, and a
// shell value that would have won cannot.
//
// FAILURE MODE, stated so it is deliberate: an operator who exported
// DATABASE_URL to a local database of their own and expected the gate to use
// it gets the .env target instead, and the console says which source was
// used. That is a different LOCAL database, not a stranger's.
//
// NO VALUE IS EVER PRINTED by anything here. A connection string carries a
// host and a project ref, and this repository is public.

import { LOCAL_DB_HOSTS } from "./guard";
import { readDotEnvValue } from "./resolve-env";

// The variables that decide which data the gate's reads and writes land on.
// The two keys are not endpoints; they travel with the pin because an anon
// key issued by one project is meaningless against another, so carrying a
// pinned URL beside an ambient key would produce a failure that looks like a
// product defect.
export const GATE_PINNED_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type GatePinnedVariable = (typeof GATE_PINNED_VARIABLES)[number];

// The three that must be present and must resolve to a local host. A
// candidate carrying only some of them is refused rather than completed from
// another source: a half-named target is exactly the mixture this finding is
// about.
const REQUIRED_ENDPOINTS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;

export type GateDbCandidate = {
  // Who named this target, in words an operator can act on. Printed on both
  // the approval and the refusal.
  readonly source: string;
  readonly values: Readonly<Partial<Record<GatePinnedVariable, string | undefined>>>;
};

export type GateDbVerdict =
  | {
      readonly allowed: true;
      readonly source: string;
      readonly pinned: Readonly<Partial<Record<GatePinnedVariable, string>>>;
      readonly reason: string;
    }
  | { readonly allowed: false; readonly reason: string };

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

const isLocal = (value: string): boolean => {
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }
  return LOCAL_DB_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase());
};

// PURE. The candidates are resolved elsewhere so this can be tested without
// an environment, which is the same split the two interlocks beside it use.
export const assessGateDbTarget = (
  candidates: readonly GateDbCandidate[],
): GateDbVerdict => {
  // THE FIRST SOURCE THAT NAMES A DATABASE DECIDES, and if what it named is
  // wrong the run is refused rather than continued down the list. Falling
  // through would mean a malformed deliberate pin silently handing the gate
  // to a different target, which is the failure this file exists to stop.
  const naming = candidates.find((candidate) =>
    present(candidate.values.DATABASE_URL),
  );
  if (naming === undefined) {
    return {
      allowed: false,
      reason:
        "no source named a database for this gate. The gate does not fall back to an ambient DATABASE_URL, because a variable the container happens to carry is not a target anyone chose. Set PULSE_GATE_DATABASE_URL, PULSE_GATE_DIRECT_URL and PULSE_GATE_SUPABASE_URL, or put DATABASE_URL, DIRECT_URL and NEXT_PUBLIC_SUPABASE_URL in a .env file at the package root.",
    };
  }

  for (const name of REQUIRED_ENDPOINTS) {
    const value = naming.values[name];
    if (!present(value)) {
      return {
        allowed: false,
        reason: `${naming.source} named a database but did not name the ${name} that goes with it (PULSE_GATE_DIRECT_URL and PULSE_GATE_SUPABASE_URL are the names for that source). A half-named target is refused: the missing value would be taken from the ambient environment, which is the mixture this interlock exists to prevent.`,
      };
    }
    if (!isLocal(value)) {
      return {
        allowed: false,
        reason: `${naming.source} named a ${name} that is not a local stack. This gate creates households, imports statements and writes merchant rules, and it may only do that against a database on this machine. There is no override. The resolved value is deliberately not printed: this repository is public.`,
      };
    }
  }

  const pinned: Partial<Record<GatePinnedVariable, string>> = {};
  for (const name of GATE_PINNED_VARIABLES) {
    const value = naming.values[name];
    if (value !== undefined) {
      pinned[name] = value;
    }
  }

  return {
    allowed: true,
    source: naming.source,
    pinned,
    reason: `the gate's database target was named by ${naming.source} and is a local stack`,
  };
};

// THE SOURCES, resolved from the real environment. Kept beside the predicate
// so a reader sees in one file both what is checked and where it comes from.
export const gateDbCandidates = (
  env: Record<string, string | undefined> = process.env,
  fromDotEnv: (name: string) => string | undefined = readDotEnvValue,
): readonly GateDbCandidate[] => [
  {
    source: "the PULSE_GATE_* variables",
    values: {
      DATABASE_URL: env["PULSE_GATE_DATABASE_URL"],
      DIRECT_URL: env["PULSE_GATE_DIRECT_URL"] ?? env["PULSE_GATE_DATABASE_URL"],
      NEXT_PUBLIC_SUPABASE_URL: env["PULSE_GATE_SUPABASE_URL"],
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env["PULSE_GATE_SUPABASE_ANON_KEY"],
      SUPABASE_SERVICE_ROLE_KEY: env["PULSE_GATE_SUPABASE_SERVICE_ROLE_KEY"],
    },
  },
  {
    source: "the .env file at the package root",
    values: {
      DATABASE_URL: fromDotEnv("DATABASE_URL"),
      DIRECT_URL: fromDotEnv("DIRECT_URL"),
      NEXT_PUBLIC_SUPABASE_URL: fromDotEnv("NEXT_PUBLIC_SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fromDotEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: fromDotEnv("SUPABASE_SERVICE_ROLE_KEY"),
    },
  },
];

export class GateDbTargetRefused extends Error {
  constructor(reason: string) {
    super(`gate database target: ${reason}`);
    this.name = "GateDbTargetRefused";
  }
}

// THE ENFORCEMENT, called from playwright.config.ts at module scope so it runs
// before a web server is spawned and again inside every worker that loads the
// config. It THROWS on refusal, which aborts the run, and on approval it
// ASSIGNS the pinned values so nothing downstream can resolve a different one.
export const enforceGateDbTarget = (
  env: Record<string, string | undefined> = process.env,
): Readonly<Partial<Record<GatePinnedVariable, string>>> => {
  const verdict = assessGateDbTarget(gateDbCandidates(env));
  if (!verdict.allowed) {
    throw new GateDbTargetRefused(verdict.reason);
  }
  for (const [name, value] of Object.entries(verdict.pinned)) {
    env[name] = value;
  }
  return verdict.pinned;
};

// WHAT A TEST THAT OPENS A CLIENT ITSELF MUST CALL. The config's enforcement
// covers every run through `playwright test`, and this covers the case the
// config cannot: a spec imported by some other runner, now or later. It reads
// exactly what `new PrismaClient()` reads.
export const assertGateDbTargetIsLocal = (
  env: Record<string, string | undefined> = process.env,
): void => {
  const value = env["DATABASE_URL"];
  if (!present(value) || !isLocal(value)) {
    throw new GateDbTargetRefused(
      "this test opens a database client of its own, and DATABASE_URL is absent or is not a local stack. Refusing to write to a database nobody named. The resolved value is deliberately not printed: this repository is public.",
    );
  }
};
