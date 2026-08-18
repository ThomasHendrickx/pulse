import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ImportFailureReason, ImportRecord } from "../application/ports";

// The result half of the import conversation: a re-upload of overlapping
// periods reports added versus already-known counts and asks nothing.

const FAILURE_KEYS: Record<ImportFailureReason, string> = {
  "mixed-accounts": "failedMixedAccounts",
  undetectable: "failedUndetectable",
  unparseable: "failedUnparseable",
};

export const ImportResult = async ({
  record,
}: {
  readonly record: ImportRecord;
}) => {
  const t = await getTranslations();

  if (record.status === "FAILED") {
    const reasonKey = FAILURE_KEYS[record.failureReason ?? "unparseable"];
    return (
      <section className="import-screen" data-testid="import-failed">
        <h1>{t("importFailedTitle")}</h1>
        <p className="import-lead">{t(reasonKey)}</p>
        <Link href="/import">{t("backToImportLink")}</Link>
      </section>
    );
  }

  return (
    <section className="import-screen" data-testid="import-result">
      <h1>{t("importCompleted")}</h1>
      <dl className="import-counts">
        <div>
          <dt>{t("rowsAddedLabel")}</dt>
          <dd className="import-count" data-testid="rows-added">
            {record.rowsAdded ?? 0}
          </dd>
        </div>
        <div>
          <dt>{t("rowsKnownLabel")}</dt>
          <dd className="import-count" data-testid="rows-known">
            {record.rowsKnown ?? 0}
          </dd>
        </div>
      </dl>
      <Link href="/import">{t("importAgainLink")}</Link>
    </section>
  );
};
