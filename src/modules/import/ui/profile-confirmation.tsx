import Link from "next/link";
import { LinkPending } from "@/platform/ui/link-pending";
import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import { SubmitButton } from "@/platform/ui/submit-button";
import { maskAccountNumbers } from "@/platform/ui/mask-account-number";
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
  carriesOwnAccount,
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
  // Whether the FILE ITSELF carries an own-account column (M3-P14). A file
  // that does is a current-account statement and its account must have
  // been registered at setup; a file that does not is a card (decision
  // D-48) and its account is declared here at first sight. This is what
  // decides whether the declaration fieldset renders at all.
  readonly carriesOwnAccount: boolean;
  readonly parseFailed: boolean;
  readonly status: string | undefined;
}) => {
  const t = await getTranslations();
  // Only the card shape is declared here now (M3-P14, decision D-48).
  const needsDeclaration = landingLabel === undefined && !carriesOwnAccount;
  const unregistered = landingLabel === undefined && carriesOwnAccount;
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
      {unregistered ? (
        /* THE UNKNOWN IS NOT HIDDEN (pulse-frontend section 5): the file
           names an account this household never registered, and the screen
           says so BEFORE the submit that will refuse it, naming the setup
           screen and linking to it. */
        <p className="import-note" data-testid="landing-unregistered">
          {t.rich("landingUnregistered", {
            setup: (chunks) => (
              <Link href="/accounts">
                {chunks}
                <LinkPending />
              </Link>
            ),
          })}
        </p>
      ) : landingLabel === undefined ? (
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
                  {/* THE ACCOUNT MASK JOINS THE CARD MASK HERE (M3-P13 fix
                      round, findings HZ-M3P13-02 and CR-M3P13-03). This cell
                      falls back to the counterparty ACCOUNT when the row
                      carries no name, so it is a dedicated account column,
                      and the card mask beside it does not touch an account
                      number: every previewed transfer printed the
                      counterparty's account whole, on the screen the comment
                      above records the owner photographing. The descriptor
                      cell has the same defect for a transfer line, whose
                      descriptor carries the account exactly as the statement
                      prints it. Display only, exactly as the card mask is:
                      the parsed row, the stored rawLine and every key are
                      untouched. */}
                  <td>
                    {maskAccountNumbers(
                      maskCardNumbers(
                        row.counterpartyName ?? row.counterpartyIban ?? "",
                      ),
                    )}
                  </td>
                  <td className="preview-descriptor">
                    {maskAccountNumbers(maskCardNumbers(row.description))}
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
              <SubmitButton formAction={previewImportAction}>
                {t("previewAgain")}
              </SubmitButton>
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
            {/* NO RING CONTROL HERE (M3-P14, criterion 14.5). The ring is
                answered once, at setup, and a second place to answer it is
                a second place to answer it wrongly. This fieldset is now
                reached only by a file with no own-account column, which is
                a card, and a card is a POT account by definition
                (pulse-domain section 1: the pot ring is current accounts
                and cards). That is forced by the shape, not inferred from
                a name, so nothing is defaulted here that the household
                could have answered differently. */}
          </fieldset>
        ) : null}

        <SubmitButton className="import-primary" testId="confirm-import">
          {t("confirmAndImport")}
        </SubmitButton>
      </form>
    </section>
  );
};
