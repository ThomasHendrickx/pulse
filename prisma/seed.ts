import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { fixedClock } from "../src/platform/clock";

// Seed for local development and tests: ONE household with ONE user
// (charter: one user per household in v1). Deterministic on purpose: fixed
// ids, fixed clock, so every db:reset produces an identical starting state.
//
// The auth identity lives in Supabase, never locally. When the service role
// key is available (local `supabase start`), the seed creates the matching
// confirmed auth user so the seeded login works end to end. Without it only
// the household is seeded and the warning says the dev login was not
// created: a users row with no auth identity would be an orphan that arms
// the half-session collision (fix round 1, finding CR-005).

const SEED_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
const SEED_USER_ID = "00000000-0000-4000-8000-000000000002";
const SEED_CLOCK = fixedClock(new Date("2026-08-01T08:00:00.000Z"));

// THE GATE-TARGET ASSERTIONS THAT STOOD HERE ARE WITHDRAWN, loudly (clause
// R-087, decision D-62, criterion 12.23). This file called
// assertGateDbTargetIsLocal at module scope ahead of `new PrismaClient()`
// and assertGateApiTargetIsLocal ahead of `createClient` (M3-P12 fix round
// eight, CRITERIA finding CR7-M3P12-01); both came from
// src/platform/db/gate-target.ts, which left the tree with the target
// interlock D-62 withdrew. What guards this file now is the interlock the
// repository already has: this is the registered Prisma seed hook, it runs
// inside db:reset and db:migrate, and both of those run guard-cli.ts FIRST,
// which refuses unless DATABASE_URL and DIRECT_URL both name the local
// stack. THE SUPABASE API DOOR IS NOT COVERED BY THAT GUARD and after this
// withdrawal nothing refuses it here: guard-cli checks the two connection
// strings and nothing else, so the service-role key and API URL travel
// unchecked, exactly the state CR7-M3P12-01 found before the withdrawn
// assertion was added. Criterion 12.23 confines itself to the routine and
// the destructive database commands and says so; the settled posture for
// every other non-production entry point is the question the plan's parked
// surface carries (the assessNonProductionDbTarget entry), and this comment
// exists so the next reader finds the open door stated rather than papered
// over. The practical mitigation stands one step earlier: a db:reset whose
// connection strings are pinned local is being run by an operator who has
// pinned the environment, and the seed warns and skips when the service-role
// key is absent.

const prisma = new PrismaClient();

const seedAuthUser = async (email: string, password: string): Promise<string | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing: the seeded dev login was NOT created. Seeding the household only; no users row is written, because a users row without an auth identity is an orphan that collides with a later real sign-up (fix round 1, finding CR-005).",
    );
    return null;
  }

  // A service-role key against a project API is a door to a database exactly
  // as a connection string is, and this one CREATES A USER. The gate-target
  // assertion that refused a non-local API here left with decision D-62; the
  // withdrawal note at the top of this file states what that leaves open.
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Paginate the WHOLE auth user list (fixed in M1-P4): listUsers()
  // returns only its first page (50 rows by default), so once e2e runs
  // had registered more than a page of throwaway users, the seeded login
  // stopped being found on page one and the createUser below failed with
  // "already been registered" on every db:reset. An existence check that
  // reads one page of a paginated list is not an existence check.
  const PER_PAGE = 1000;
  for (let page = 1; ; page += 1) {
    const existing = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (existing.error) {
      throw new Error(`Listing auth users failed: ${existing.error.message}`);
    }
    const match = existing.data.users.find((u) => u.email === email);
    if (match) {
      return match.id;
    }
    if (existing.data.users.length < PER_PAGE) {
      break;
    }
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

  const authUserId = await seedAuthUser(email, password);
  const createdAt = SEED_CLOCK.now();

  await prisma.household.upsert({
    where: { id: SEED_HOUSEHOLD_ID },
    update: {},
    create: { id: SEED_HOUSEHOLD_ID, name: "Seed household", createdAt },
  });

  if (authUserId === null) {
    console.log(
      `Seeded household ${SEED_HOUSEHOLD_ID} only; no dev login exists in this configuration.`,
    );
    return;
  }

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
