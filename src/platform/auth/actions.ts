"use server";

import { redirect } from "next/navigation";
import { createHouseholdForNewUser } from "./household";
import { createSupabaseServerClient } from "./supabase-server";

// Server actions for the auth boundary. Each one does one thing: talk to
// Supabase Auth, then redirect. No business logic lives here.

const credentialsFrom = (formData: FormData) => {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
};

export const signUpAction = async (formData: FormData): Promise<void> => {
  const { email, password } = credentialsFrom(formData);
  if (email === "" || password === "") {
    redirect("/sign-up");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    redirect("/sign-up");
  }

  await createHouseholdForNewUser({ authUserId: data.user.id, email });
  redirect("/");
};

export const signInAction = async (formData: FormData): Promise<void> => {
  const { email, password } = credentialsFrom(formData);
  if (email === "" || password === "") {
    redirect("/sign-in");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/sign-in");
  }

  redirect("/");
};

export const signOutAction = async (): Promise<void> => {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
};
