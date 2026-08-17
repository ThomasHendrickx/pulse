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
