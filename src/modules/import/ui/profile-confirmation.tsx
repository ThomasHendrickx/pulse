import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import type { ParsedRow } from "../domain/parse-statement";
import { confirmImportAction, previewImportAction } from "./actions";
import { ImportStatusLine } from "./import-status-line";
import { PREVIEW_ROW_LIMIT } from "./preview-limit";

// The stored profile name for a code-owned layout: the template id, a
// stable machine identifier rather than translated copy, because profile
// names must stay constant across languages for the (householdId, name)
// uniqueness to mean one profile per source.
const profileNameFromSpec = (specJson: string): string => {
  try {
    const parsed: unknown = JSON.parse(specJson);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "templateId" in parsed &&
      typeof (parsed as { templateId: unknown }).templateId === "string"
    ) {
      return (parsed as { templateId: string }).templateId;
    }
  } catch {
    // fall through to the constant below
  }
  return "pdf-layout";
};

// Detect, propose, confirm: the detected format rendered over a five-row
// preview EXACTLY as the rows will be stored, with the account declared at
// first sight when the file's account is unknown (asked once, never
// again). The format description is editable, so a misdetection is fixed
// here, before anything reaches the ledger, never after.

export const ProfileConfirmation = async ({
  importId,
  specKind,
  specJson,
  previewRows,
  landingLabel,
  parseFailed,
  status,
}: {
  readonly importId: string;
  // "pdf-layout" means the format is CODE-OWNED (a recognised layout
  // template): the ask-once account declaration stays exactly as is and
  // ONLY the format question disappears (pulse-v0.2-pdf-addendum.md:27),
  // so no format-name field and no spec editor render; the spec and a
  // template-derived profile name travel as hidden fields instead.
  readonly specKind: "delimited" | "pdf-layout";
  readonly specJson: string;
  readonly previewRows: readonly ParsedRow[];
  // The label of the account this file's rows will land in, resolved by
  // the same rule the confirm use case applies; undefined means a new
  // account will be declared here (finding F1: the landing account is
  // named everywhere the user sees the import).
  readonly landingLabel: string | undefined;
  readonly parseFailed: boolean;
  readonly status: string | undefined;
}) => {
  const t = await getTranslations();
  const needsDeclaration = landingLabel === undefined;
  const isPdfLayout = specKind === "pdf-layout";
  return (
    <section className="import-screen">
      <h1>{t("confirmFormat")}</h1>
      <p className="import-lead">
        {isPdfLayout
          ? t("confirmBodyPdf", { count: PREVIEW_ROW_LIMIT })
          : t("confirmBody")}
      </p>
      <ImportStatusLine status={status} />
      {landingLabel === undefined ? (
        <p className="import-note" data-testid="landing-new">
          {t("landingNew")}
        </p>
      ) : (
        <p className="import-note" data-testid="landing-account">
          {t("landingKnown", { label: landingLabel })}
        </p>
      )}

      {parseFailed ? (
        <p className="import-status" data-testid="preview-parse-failed">
          {t("failedUnparseable")}
        </p>
      ) : (
        <div className="preview-block">
          <p className="import-note">
            {t("previewNote", { count: PREVIEW_ROW_LIMIT })}
          </p>
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
                  {/* THE RAW PARSED DESCRIPTOR, masked in the RENDERING
                      only (M3-P6 fix round 1, finding CR-M3P6-01). This is
                      the screen the owner photographed: a card descriptor
                      embeds the full card number and this preview showed it
                      whole. The parsed row itself is untouched, the stored
                      rawLine keeps the number the bank printed, and nothing
                      here reaches a key, a rule subject or a fact. */}
                  <td>
                    {maskCardNumbers(
                      row.counterpartyName ?? row.counterpartyIban ?? "",
                    )}
                  </td>
                  <td className="preview-descriptor">
                    {maskCardNumbers(row.description)}
                  </td>
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

        {isPdfLayout ? (
          <>
            {/* The format question disappears for recognised layouts:
                the code-owned template id names the stored profile and
                the spec is not user-editable. */}
            <input type="hidden" name="profileName" value={profileNameFromSpec(specJson)} />
            <input type="hidden" name="spec" value={specJson} />
          </>
        ) : (
          <>
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
          </>
        )}

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
            {/* THE RING QUESTION GOES ON OFFERING BOTH ANSWERS, and the
                copy beside each states its CONSEQUENCE (M3-P14 criterion
                14.11 witness ONE, DR-0030). Uploading is the only way into
                Pulse today, so the order every household is actually in is
                upload first and accounts screen later, and on that order
                this answer is what declares the account. It decides whether
                this statement's rows are counted in the month or held and
                counted nowhere, in BOTH directions, and nothing else stands
                behind it. Nothing defaults it: a declaration carrying no
                ring is refused by name. */}
            <label className="import-field">
              <span>{t("accountRingField")}</span>
              <select
                name="accountRole"
                required
                defaultValue=""
                data-testid="account-ring"
              >
                <option value="" disabled />
                <option value="POT">{t("ringPot")}</option>
                <option value="RESERVE">{t("ringReserve")}</option>
              </select>
            </label>
            <p className="import-note" data-testid="ring-pot-meaning">
              {t("ringPot")}
              {": "}
              {t("ringPotMeaning")}
            </p>
            <p className="import-note" data-testid="ring-reserve-meaning">
              {t("ringReserve")}
              {": "}
              {t("ringReserveMeaning")}
            </p>
            {/* THE WRONG ANSWER IS RECOVERABLE AND THIS SAYS WHERE
                (criterion 14.11 witness THREE). The control this names lives
                on the accounts screen; criterion 15.9 walks the whole path
                to it, which is why the two phases reach a household
                together. */}
            <p className="import-note" data-testid="ring-change-hint">
              {t("importRingChangeHint")}
              {" "}
              <Link href="/accounts" data-testid="ring-change-link">
                {t("importRingChangeLink")}
              </Link>
            </p>
          </fieldset>
        ) : null}

        <button type="submit" className="import-primary" data-testid="confirm-import">
          {t("confirmAndImport")}
        </button>
      </form>
    </section>
  );
};
