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
    // An authenticated Supabase user without a household link cannot act as
    // a tenant. Send them back to sign-in rather than inventing a context.
    redirect("/sign-in");
  }

  return { householdId: householdId(row.householdId), userId: userId(row.id) };
};
