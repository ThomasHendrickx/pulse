import { redirect } from "next/navigation";
import { prisma } from "../db/client";
import { householdId, userId, type HouseholdContext } from "../tenancy";
import { createSupabaseServerClient } from "./supabase-server";

// THE ONE BOUNDARY where the session becomes a household context
// (architecture section 9). Everything below this call takes the context as
// an explicit argument; nothing below it reads the session again.

export const requireHouseholdContext = async (): Promise<HouseholdContext> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row) {
    // An authenticated Supabase user without a users row is a broken
    // half-session (an interrupted sign-up, or an auth user created outside
    // the app). Destroy the session BEFORE redirecting: with it still
    // alive, the middleware bounces /sign-in back to / and this guard
    // bounces / back to /sign-in, so the browser live-locks with sign-out
    // unreachable (fix round 1, finding CR-001 in both M1-P1 verdicts).
    // Signing out here is what makes the redirect target reachable.
    await supabase.auth.signOut();
    redirect("/sign-in?status=incomplete-signup");
  }

  return { householdId: householdId(row.householdId), userId: userId(row.id) };
};
