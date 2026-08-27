import { NextResponse } from "next/server";

// DELIBERATE, BOUNDED DIAGNOSTIC ENDPOINT, sibling of /api/health/db and
// /api/health/pdf (M3-P17). The fleet cannot read Vercel function logs, so
// this route answers the one question a later phase (M3-P16) needs to
// decide its own entry condition: what commit is this deployed build built
// from, and which deployment environment is it running in? Public, no auth,
// the same disclosure level owner-accepted for the two sibling probes
// (src/app/api/health/db/route.ts:16 through :22). A commit sha and a
// deployment environment describe a build of a public repository (DR-0024);
// neither names a household, an account, an amount or a date.
//
// THE MARKER "unstamped" AND THE TWO VARIABLE NAMES BELOW ARE FIXED BY THE
// PLAN, not chosen here: M3-P16 decides a terminal state by comparing
// against the marker, and a wrong variable name is indistinguishable from a
// platform that stamps nothing at all, so both are pinned rather than
// recalled. The marker carries no hexadecimal-only characters, so it can
// never be mistaken for a commit sha.
//
// THIS ROUTE READS process.env DIRECTLY rather than through
// src/platform/config.ts's confinement (pulse-typescript section 6). That is
// a deliberate, narrow exception: the phase declaration for M3-P17 does not
// list src/platform/config.ts among the files this phase may touch, the two
// variables named here are Vercel platform facts rather than application
// secrets, and the read happens at REQUEST TIME inside the handler, never at
// module scope, so it carries the same build-safety property
// (src/platform/config.ts:1-10) without adding to that module. Any sibling
// route that later needs the same two facts should read them the same way,
// here, rather than reintroducing a third env read site.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const UNSTAMPED = "unstamped";

const buildFact = (value: string | undefined): string =>
  value === undefined || value === "" ? UNSTAMPED : value;

export async function GET() {
  return NextResponse.json({
    sha: buildFact(process.env.VERCEL_GIT_COMMIT_SHA),
    deploymentEnvironment: buildFact(process.env.VERCEL_ENV),
  });
}
