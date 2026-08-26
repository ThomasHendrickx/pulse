import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { fixedClock } from "../src/platform/clock";
import {
  assertGateApiTargetIsLocal,
  assertGateDbTargetIsLocal,
} from "../src/platform/db/gate-target";

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

// THE TARGET INTERLOCK, BEFORE A CLIENT EXISTS (M3-P12 fix round eight,
// CRITERIA finding CR7-M3P12-01).
//
// This file was the one door in the tree that carried no interlock of any
// kind, and it is the worst one to leave open: it creates an AUTH USER
// through the service-role admin API and writes a household. It is the
// registered Prisma seed hook, so it runs inside db:reset and db:migrate, and
// the guard those two scripts do run (src/platform/db/guard-cli.ts) checks
// DATABASE_URL and DIRECT_URL and NOTHING ELSE: the Supabase API URL and the
// service role key travel unchecked on that path. An operator who pinned the
// two connection strings to a local stack, exactly as instructed, still
// created an auth user in whichever project the ambient Supabase variables
// named. In this fleet's containers those ambient variables are present and
// belong to a different project.
//
// SO THE REFUSAL IS TOTAL AND IT IS FAIL CLOSED. This seed is for local
// development and tests, and it says so in its own first line; there is no
// legitimate deployed target for it, so there is no override flag here. A
// flag asserting the target is right is the assertion being checked.
//
// ORDER IS THE CONTRACT: both assertions run before the client they guard is
// constructed, so a refused run has opened nothing at all. The database
// assertion sits at module scope, ahead of `new PrismaClient()`; the API
// assertion sits immediately ahead of `createClient`, after the presence
// check, because an absent key opens no door and keeps the existing
// seed-the-household-only behaviour.
//
// SIBLING IMPLEMENTATIONS of this same mechanism, so the next reader knows
// the rule is not local: test/e2e/merchant-rule-write.spec.ts (Prisma door),
// test/e2e/auth.spec.ts (admin door), playwright.config.ts
// (enforceGateDbTarget at module scope), scripts/rederive-merchant-rules.ts
// (its own stricter host-and-ref interlock, src/platform/db/target-guard.ts),
// and src/platform/db/client.ts, which is the application's own client and
// deliberately carries a DIFFERENT guard (assessDevServerDbTarget) because
// production is the one target it may legitimately open. The scan that holds
// all of these to the rule is test/db/gate-target.test.ts, and it reads the
// tracked tree.
assertGateDbTargetIsLocal(process.env, "prisma/seed.ts");

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
  // as a connection string is, and this one CREATES A USER. Refuse before the
  // client exists.
  assertGateApiTargetIsLocal(process.env, "prisma/seed.ts");

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
