// Environment variables are parsed here and nowhere else. A missing
// required variable is an unexpected failure, so it throws (pulse-typescript
// section 5), and the throw happens at the POINT OF USE at request time,
// never at module load: BUILD-SAFE by contract since deploy-verify round 5.
// A Vercel build imports every route module during page-data collection, so
// nothing in this module (and nothing importing it) may read or validate
// env at module scope; accessors validate on first access and memoize, and
// a missing variable fails the specific request path with the named error
// below, logged once per variable with the [pulse:config] prefix so the
// function logs say which variable broke instead of the build dying.

const valueCache = new Map<string, string>();
const missingLogged = new Set<string>();

const required = (name: string): string => {
  const cached = valueCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const value = process.env[name];
  if (value === undefined || value === "") {
    // Message unchanged across rounds: it identified the root cause in the
    // owner's logs and stays byte-stable for grepping.
    if (!missingLogged.has(name)) {
      missingLogged.add(name);
      console.error(`[pulse:config] Missing required environment variable ${name}`);
    }
    throw new Error(`Missing required environment variable ${name}`);
  }
  valueCache.set(name, value);
  return value;
};

export type SupabaseConfig = {
  readonly url: string;
  readonly anonKey: string;
};

let cachedSupabaseConfig: SupabaseConfig | undefined;

export const supabaseConfig = (): SupabaseConfig =>
  (cachedSupabaseConfig ??= {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  });

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

// Raw, optional reads for the connectivity triage (deploy-verify round 6).
// Server side only; the health route derives BOOLEANS from these and never
// echoes any part of the value. Kept here so process.env stays confined to
// this module (plus the documented guard-cli exemption).
export const rawDatabaseUrl = (): string | undefined => process.env.DATABASE_URL;
export const rawDirectUrl = (): string | undefined => process.env.DIRECT_URL;

export type DatabaseUrlDiagnostic = {
  readonly ok: boolean;
  readonly summary: string;
};

// Cold-start diagnostic for the Vercel function logs (deploy-verify round):
// says whether DATABASE_URL is present and whether its scheme looks like
// Postgres, and NEVER prints any part of the value beyond the scheme. Never
// throws, so it is safe at module scope.
export const databaseUrlDiagnostic = (): DatabaseUrlDiagnostic => {
  const value = process.env.DATABASE_URL;
  if (value === undefined || value === "") {
    return { ok: false, summary: "absent" };
  }
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return { ok: false, summary: "present but does not parse as a URL" };
  }
  if (protocol !== "postgresql:" && protocol !== "postgres:") {
    return {
      ok: false,
      summary: `present but scheme is not postgresql (got "${protocol.replace(":", "")}")`,
    };
  }
  return { ok: true, summary: "present, scheme ok" };
};
