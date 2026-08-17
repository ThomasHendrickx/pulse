// Environment variables are parsed here and nowhere else. A missing
// required variable is an unexpected failure, so it throws (pulse-typescript
// section 5). Values are read lazily so importing this module never fails
// at build time before the environment exists.

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

export type SupabaseConfig = {
  readonly url: string;
  readonly anonKey: string;
};

export const supabaseConfig = (): SupabaseConfig => ({
  url: required("NEXT_PUBLIC_SUPABASE_URL"),
  anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

export type DatabaseUrlDiagnostic = {
  readonly ok: boolean;
  readonly summary: string;
};

// Cold-start diagnostic for the Vercel function logs (deploy-verify round):
// says whether DATABASE_URL is present and whether its scheme looks like
// Postgres, and NEVER prints any part of the value beyond the scheme.
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
