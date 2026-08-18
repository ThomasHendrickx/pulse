import { notFound } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import { findAccountByIban } from "@/modules/accounts/application";
import {
  detectSourceProfile,
  getImport,
  parseSourceProfileSpec,
  parseStatement,
  type SourceProfileSpec,
} from "@/modules/import/application";
import { ImportResult, ProfileConfirmation } from "@/modules/import/ui";

// Thin route for one import: dispatch on the status machine. The
// AWAITING_DECLARATION branch re-runs deterministic detection on the
// stored bytes (same bytes, same spec, so nothing needs to be persisted
// between upload and confirm), unless the user's edited spec rides in as
// a validated query parameter from the preview-again round trip.

const specFromQuery = (raw: string | undefined): SourceProfileSpec | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const spec = parseSourceProfileSpec(parsed);
  return spec.ok ? spec.value : undefined;
};

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{
    readonly spec?: string;
    readonly status?: string;
  }>;
}) {
  const context = await requireHouseholdContext();
  const { id } = await params;
  const { spec: querySpec, status } = await searchParams;

  const record = await getImport(context, id);
  if (record === null) {
    notFound();
  }

  if (record.status !== "AWAITING_DECLARATION") {
    return <ImportResult record={record} />;
  }

  const detected = detectSourceProfile(record.rawContent);
  const spec = specFromQuery(querySpec) ?? (detected.ok ? detected.value : undefined);
  if (spec === undefined) {
    // Undetectable content in an awaiting import should not happen (the
    // upload path fails those), but a stale link must still render.
    return <ImportResult record={{ ...record, status: "FAILED" }} />;
  }

  const parsed = parseStatement(record.rawContent, spec);
  const previewRows = parsed.ok ? parsed.value.rows.slice(0, 5) : [];
  const fileIban = parsed.ok ? parsed.value.accountIbans[0] : undefined;
  const knownAccount =
    fileIban === undefined ? null : await findAccountByIban(context, fileIban);

  return (
    <ProfileConfirmation
      importId={record.id}
      specJson={JSON.stringify(spec, null, 2)}
      previewRows={previewRows}
      needsDeclaration={knownAccount === null}
      parseFailed={!parsed.ok}
      status={status}
    />
  );
}
