import { NextResponse } from "next/server";
import { probePdfExtraction } from "@/modules/import/adapters/pdf-text-extractor";

// DELIBERATE, BOUNDED DIAGNOSTIC ENDPOINT, sibling of /api/health/db and
// under the same redaction discipline (deploy-verify defect round): the
// fleet cannot read Vercel function logs, so this route answers the one
// question the owner's production 500 required log access to answer: can
// THIS deployed runtime load the PDF extraction module and run a real
// extraction? The probe document is embedded in the server bundle, so a
// deployment that omits extraction files still answers. Disclosure is
// staged booleans plus at most an error NAME and string CODE (for
// example ERR_MODULE_NOT_FOUND); never a message, an env value or a
// path. Public without auth like its db sibling, accepted by the same
// owner direction.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await probePdfExtraction();
  const ok = probe.moduleLoad === "ok" && probe.extraction === "ok";
  return NextResponse.json(
    {
      status: ok ? "ok" : "error",
      pdfExtraction: ok ? "ok" : "failed",
      moduleLoad: probe.moduleLoad,
      extraction: probe.extraction,
      ...(probe.errorName !== undefined ? { errorName: probe.errorName } : {}),
      ...(probe.errorCode !== undefined ? { errorCode: probe.errorCode } : {}),
    },
    { status: ok ? 200 : 500 },
  );
}
