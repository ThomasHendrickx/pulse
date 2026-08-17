import { NextResponse } from "next/server";
import { databaseUrlDiagnostic } from "@/platform/config";
import { prisma } from "@/platform/db/client";
import { redactConnectionTargets } from "@/platform/db/redact";

// DELIBERATE, BOUNDED DIAGNOSTIC ENDPOINT (deploy-verify round 3, owner
// directed). The fleet cannot read Vercel function logs, so this route
// surfaces the same disclosure level as the [pulse:db] log lines over
// HTTP: whether the deployed function can reach the database, and on
// failure the error name, string code, a redacted message capped at 300
// characters, and the scheme-only DATABASE_URL diagnostic. It exposes db
// up/down status publicly with no auth, which is accepted for v1 by owner
// direction. Never any part of a connection string: messages pass through
// redactConnectionTargets before leaving the server.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stringCodeOf = (cause: unknown): string | undefined => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "reachable" });
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
      },
      { status: 500 },
    );
  }
}
