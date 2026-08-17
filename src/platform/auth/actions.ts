"use server";

import { redirect } from "next/navigation";
import { logAuthFailure } from "./diagnostics";
import { createHouseholdForNewUser } from "./household";
import { createSupabaseServerClient } from "./supabase-server";

// Server actions for the auth boundary. Each one does one thing: talk to
// Supabase Auth, then redirect. No business logic lives here. Failures are
// surfaced as a status query parameter the auth screens translate into a
// localized line; the parameter values below are whitelisted by the pages
// and never rendered raw (fix round 1, finding CR-004).

const credentialsFrom = (formData: FormData) => {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
};

export const signUpAction = async (formData: FormData): Promise<void> => {
  const { email, password } = credentialsFrom(formData);
  if (email === "" || password === "") {
    redirect("/sign-up?status=signup-failed");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    redirect("/sign-up?status=signup-failed");
  }

  // Session cookies may exist from here on. A failure between signUp
  // succeeding and the household create committing would leave an
  // authenticated user with no tenant, the live-lock state finding CR-001
  // constructs; the catch destroys the half-session so a failed sign-up
  // never leaves a session pointing at nothing.
  let created = false;
  try {
    await createHouseholdForNewUser({ authUserId: data.user.id, email });
    created = true;
  } catch (cause) {
    logAuthFailure("sign-up household-create", email, cause);
    await supabase.auth.signOut();
  }
  if (!created) {
    redirect("/sign-up?status=signup-failed");
  }

  if (!data.session) {
    // Email confirmation is enabled on this Supabase project: the user and
    // their household row exist but no session was issued. Say so instead
    // of bouncing the visitor to sign-in unexplained.
    redirect("/sign-in?status=confirm-email");
  }

  redirect("/");
};

export const signInAction = async (formData: FormData): Promise<void> => {
  const { email, password } = credentialsFrom(formData);
  if (email === "" || password === "") {
    redirect("/sign-in?status=signin-failed");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/sign-in?status=signin-failed");
  }

  redirect("/");
};

export const signOutAction = async (): Promise<void> => {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
};
