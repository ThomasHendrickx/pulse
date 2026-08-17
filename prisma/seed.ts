import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { fixedClock } from "../src/platform/clock";

// Seed for local development and tests: ONE household with ONE user
// (charter: one user per household in v1). Deterministic on purpose: fixed
// ids, fixed clock, so every db:reset produces an identical starting state.
//
// The auth identity lives in Supabase, never locally. When the service role
// key is available (local `supabase start`), the seed creates the matching
// confirmed auth user so the seeded login works end to end. Without it the
// database rows are still seeded and a warning is printed.

const SEED_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
const SEED_USER_ID = "00000000-0000-4000-8000-000000000002";
const SEED_CLOCK = fixedClock(new Date("2026-08-01T08:00:00.000Z"));

const prisma = new PrismaClient();

const seedAuthUser = async (email: string, password: string): Promise<string | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing: seeding database rows only, no auth user.",
    );
    return null;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existing = await admin.auth.admin.listUsers();
  if (existing.error) {
    throw new Error(`Listing auth users failed: ${existing.error.message}`);
  }
  const match = existing.data.users.find((u) => u.email === email);
  if (match) {
    return match.id;
  }

  const created = await admin.auth.admin.createUser({
    id: SEED_USER_ID,
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`Creating the seeded auth user failed: ${created.error?.message}`);
  }
  return created.data.user.id;
};

const main = async () => {
  const email = process.env.SEED_USER_EMAIL ?? "dev@pulse.local";
  const password = process.env.SEED_USER_PASSWORD ?? "pulse-dev-password";

  const authUserId = (await seedAuthUser(email, password)) ?? SEED_USER_ID;
  const createdAt = SEED_CLOCK.now();

  await prisma.household.upsert({
    where: { id: SEED_HOUSEHOLD_ID },
    update: {},
    create: { id: SEED_HOUSEHOLD_ID, name: "Seed household", createdAt },
  });

  await prisma.user.upsert({
    where: { id: authUserId },
    update: { email, householdId: SEED_HOUSEHOLD_ID },
    create: {
      id: authUserId,
      email,
      householdId: SEED_HOUSEHOLD_ID,
      createdAt,
    },
  });

  console.log(`Seeded household ${SEED_HOUSEHOLD_ID} with user ${email}.`);
};

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
