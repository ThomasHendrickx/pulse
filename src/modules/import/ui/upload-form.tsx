import { getTranslations } from "next-intl/server";
import { uploadStatementAction } from "./actions";
import { ImportStatusLine } from "./import-status-line";

// The upload half of the import conversation: one file in, one account.
// A plain form posting to a server action; no client component needed.

export const UploadForm = async ({
  status,
}: {
  readonly status: string | undefined;
}) => {
  const t = await getTranslations();
  return (
    <section className="import-screen">
      <h1>{t("importTitle")}</h1>
      <p className="import-lead">{t("uploadPrompt")}</p>
      <ImportStatusLine status={status} />
      <form action={uploadStatementAction} className="import-form">
        <label className="import-field">
          <span>{t("fileLabel")}</span>
          <input
            type="file"
            name="file"
            accept=".pdf,application/pdf,.csv,text/csv"
            required
          />
        </label>
        <button type="submit" className="import-primary">
          {t("uploadButton")}
        </button>
      </form>
    </section>
  );
};
