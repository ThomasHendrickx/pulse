import { NextResponse } from "next/server";
import {
  databaseUrlDiagnostic,
  rawDatabaseUrl,
  rawDirectUrl,
} from "@/platform/config";
import { prisma } from "@/platform/db/client";
import { redactConnectionTargets } from "@/platform/db/redact";
import {
  envHostHasIpv4,
  envUrlBooleans,
  probeCandidates,
} from "@/platform/db/triage";

// DELIBERATE, BOUNDED DIAGNOSTIC ENDPOINT (deploy-verify rounds 3 and 6,
// owner directed). The fleet cannot read Vercel function logs, so this
// route surfaces the same disclosure level as the [pulse:db] log lines
// over HTTP: whether the deployed function can reach the database, and on
// failure the error name, string code, a redacted message capped at 300
// characters, and the scheme-only DATABASE_URL diagnostic. It exposes db
// up/down status publicly with no auth, which is accepted for v1 by owner
// direction. Never any part of a connection string: messages pass through
// redactConnectionTargets before leaving the server.
//
// The connectivity object (round 6) separates network restrictions from a
// wrong pooler host: the probed candidate hosts are HARDCODED public
// shared Supabase pooler infrastructure (no env involvement at all), and
// everything derived from env values is BOOLEAN-ONLY by design; no
// hostname, port or other substring of an env value appears in the
// response. See src/platform/db/triage.ts for the derivation.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TCP_PROBE_TIMEOUT_MS = 4_000;
const DNS_TIMEOUT_MS = 3_000;

const stringCodeOf = (cause: unknown): string | undefined => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

const connectivityReport = async () => {
  const databaseUrl = rawDatabaseUrl();
  const directUrl = rawDirectUrl();
  const [candidates, databaseHostHasIpv4, directHostHasIpv4] = await Promise.all([
    probeCandidates(TCP_PROBE_TIMEOUT_MS),
    envHostHasIpv4(databaseUrl, DNS_TIMEOUT_MS),
    envHostHasIpv4(directUrl, DNS_TIMEOUT_MS),
  ]);
  return {
    candidates,
    databaseUrl: { ...envUrlBooleans(databaseUrl), hostHasIpv4: databaseHostHasIpv4 },
    directUrl: { ...envUrlBooleans(directUrl), hostHasIpv4: directHostHasIpv4 },
  };
};

export async function GET() {
  const connectivity = await connectivityReport();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "reachable", connectivity });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "non-error";
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    const message = redactConnectionTargets(rawMessage).slice(0, 300);
    const code = stringCodeOf(cause);
    return NextResponse.json(
      {
        status: "error",
        name,
        ...(code !== undefined ? { code } : {}),
        message,
        databaseUrlDiagnostic: databaseUrlDiagnostic().summary,
        connectivity,
      },
      { status: 500 },
    );
  }
}
