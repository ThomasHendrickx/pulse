import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import type { ParsedRow } from "../domain/parse-statement";
import { confirmImportAction, previewImportAction } from "./actions";
import { ImportStatusLine } from "./import-status-line";

// Detect, propose, confirm: the detected format rendered over a five-row
// preview EXACTLY as the rows will be stored, with the account declared at
// first sight when the file's account is unknown (asked once, never
// again). The format description is editable, so a misdetection is fixed
// here, before anything reaches the ledger, never after.

export const ProfileConfirmation = async ({
  importId,
  specJson,
  previewRows,
  needsDeclaration,
  parseFailed,
  status,
}: {
  readonly importId: string;
  readonly specJson: string;
  readonly previewRows: readonly ParsedRow[];
  readonly needsDeclaration: boolean;
  readonly parseFailed: boolean;
  readonly status: string | undefined;
}) => {
  const t = await getTranslations();
  return (
    <section className="import-screen">
      <h1>{t("confirmFormat")}</h1>
      <p className="import-lead">{t("confirmBody")}</p>
      <ImportStatusLine status={status} />

      {parseFailed ? (
        <p className="import-status" data-testid="preview-parse-failed">
          {t("failedUnparseable")}
        </p>
      ) : (
        <div className="preview-block">
          <p className="import-note">{t("previewNote")}</p>
          <table className="preview-table" data-testid="preview-table">
            <thead>
              <tr>
                <th scope="col">{t("date")}</th>
                <th scope="col">{t("counterparty")}</th>
                <th scope="col">{t("descriptor")}</th>
                <th scope="col" className="preview-amount-header">
                  {t("amount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => (
                <tr key={index} data-testid="preview-row">
                  <td>{row.bookingDate}</td>
                  <td>{row.counterpartyName ?? row.counterpartyIban ?? ""}</td>
                  <td className="preview-descriptor">{row.description}</td>
                  <td className="preview-amount-cell">
                    <Amount cents={row.amountCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={confirmImportAction} className="import-form">
        <input type="hidden" name="importId" value={importId} />

        <label className="import-field">
          <span>{t("profileNameLabel")}</span>
          <input type="text" name="profileName" required />
        </label>

        <details className="spec-editor">
          <summary>{t("profileSpecLabel")}</summary>
          <p className="import-note">{t("profileSpecHelp")}</p>
          <textarea
            name="spec"
            rows={12}
            defaultValue={specJson}
            spellCheck={false}
          />
          <button type="submit" formAction={previewImportAction}>
            {t("previewAgain")}
          </button>
        </details>

        {needsDeclaration ? (
          <fieldset className="account-declaration" data-testid="account-declaration">
            <legend>{t("declareAccountTitle")}</legend>
            <p className="import-note">{t("declareAccountBody")}</p>
            <label className="import-field">
              <span>{t("accountLabelField")}</span>
              <input type="text" name="accountLabel" required />
            </label>
            <label className="import-field">
              <span>{t("accountBankField")}</span>
              <input type="text" name="accountBank" required />
            </label>
            <label className="import-field">
              <span>{t("accountRingField")}</span>
              <select name="accountRole" required defaultValue="">
                <option value="" disabled />
                <option value="POT">{t("ringPot")}</option>
                <option value="RESERVE">{t("ringReserve")}</option>
              </select>
            </label>
          </fieldset>
        ) : null}

        <button type="submit" className="import-primary" data-testid="confirm-import">
          {t("confirmAndImport")}
        </button>
      </form>
    </section>
  );
};
