import { notFound } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import { findAccountByIban, getAccountById } from "@/modules/accounts/application";
import {
  detectStatement,
  findProfileForSpec,
  getImport,
  parseSourceProfileSpec,
  parseStatementBytes,
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
    // Name the account the counts refer to (finding F1).
    const account =
      record.accountId === undefined
        ? null
        : await getAccountById(context, record.accountId);
    return <ImportResult record={record} accountLabel={account?.label} />;
  }

  const detected = await detectStatement(record.rawContent);
  const spec = specFromQuery(querySpec) ?? (detected.ok ? detected.value : undefined);
  if (spec === undefined) {
    // Undetectable content in an awaiting import should not happen (the
    // upload path fails those), but a stale link must still render.
    return (
      <ImportResult
        record={{ ...record, status: "FAILED" }}
        accountLabel={undefined}
      />
    );
  }

  const parsed = await parseStatementBytes(record.rawContent, spec);
  const previewRows = parsed.ok ? parsed.value.rows.slice(0, 5) : [];

  // The landing account, resolved by the SAME rule the confirm use case
  // applies (finding F1): the file's own IBAN first, then the binding of a
  // spec-identical stored profile. Undefined means the declaration below
  // creates a new account.
  const fileIban = parsed.ok ? parsed.value.accountIbans[0] : undefined;
  let landingAccount = null;
  if (fileIban !== undefined) {
    landingAccount = await findAccountByIban(context, fileIban);
  } else if (parsed.ok) {
    const boundProfile = await findProfileForSpec(context, spec);
    if (boundProfile?.accountId !== undefined) {
      landingAccount = await getAccountById(context, boundProfile.accountId);
    }
  }

  return (
    <ProfileConfirmation
      importId={record.id}
      specKind={spec.kind}
      specJson={JSON.stringify(spec, null, 2)}
      previewRows={previewRows}
      landingLabel={landingAccount?.label}
      parseFailed={!parsed.ok}
      status={status}
    />
  );
}
