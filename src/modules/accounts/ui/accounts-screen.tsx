import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/platform/ui/submit-button";
import type { HouseholdContext } from "@/platform/tenancy";
import { listAccounts } from "../application";
import { AccountSetupForm, type AccountSetupCopy } from "./account-setup-form";
import { changeAccountRingAction } from "./actions";
import { ACCOUNTS_STATUS_KEYS, isKnownAccountsStatus } from "./status-keys";

// THE ACCOUNTS SCREEN (M3-P14). One route that asks for EVERY account at
// once before any statement is imported, and afterwards lists what is
// registered with the one ring correction v1 allows.
//
// THE EXPLANATION RENDERS BEFORE THE RING CONTROL AND IS PLAINLY VISIBLE
// (criterion 14.2, hazard H14.4, coordinator finding PR7-003). Not in a
// disclosure, not in a tooltip, not visually hidden: a collapsed
// explanation satisfies DOM order while the reader sees nothing, and this
// explanation is the ONLY guard between the owner and a savings account
// silently marked as a spending account, which produces a month that looks
// entirely correct and is wrong. It is a plain paragraph, above the form,
// asserted visible at 390 with no interaction.
//
// CARDS ARE NOT ENTERED HERE (decision D-48, criterion 14.6), and the
// screen says so rather than leaving the owner to discover it.

export const AccountsScreen = async ({
  context,
  status,
}: {
  readonly context: HouseholdContext;
  readonly status: string | undefined;
}) => {
  const t = await getTranslations();
  const accounts = await listAccounts(context);

  const copy: AccountSetupCopy = {
    labelField: t("accountLabelField"),
    bankField: t("accountBankField"),
    numberField: t("accountNumberField"),
    ringField: t("accountRingField"),
    ringChoose: t("ringChoose"),
    ringSpending: t("ringSpending"),
    ringSavings: t("ringSavings"),
    addRow: t("accountsAddRow"),
    removeRow: t("accountsRemoveRow"),
    submit: t("accountsSubmit"),
    // THE RAW MESSAGE, not the formatted one, and this is a correction of a
    // defect the production build caught (clause R-087). "Account {row}"
    // carries an ICU variable and this component cannot supply it: the row
    // number belongs to the client island, which owns the row list. Calling
    // t() here asked next-intl to format a message whose variable was not
    // provided, which the production runtime raises as
    // FORMATTING_ERROR rather than rendering. t.raw hands over the template
    // and the island substitutes; the string still comes from the catalogue
    // and all three languages carry the same placeholder.
    rowName: t.raw("accountsRowName") as string,
    errorNoRows: t("accountsErrorNoRows"),
    errorLabelMissing: t("accountsErrorLabelMissing"),
    errorBankMissing: t("accountsErrorBankMissing"),
    errorRingMissing: t("accountsErrorRingMissing"),
    errorRingInvalid: t("accountsErrorRingInvalid"),
    errorNumberEmpty: t("accountsErrorNumberEmpty"),
    errorNumberCountry: t("accountsErrorNumberCountry"),
    errorNumberLength: t("accountsErrorNumberLength"),
    errorNumberChecksum: t("accountsErrorNumberChecksum"),
    errorDuplicate: t("accountsErrorDuplicate"),
    errorAlreadyRegistered: t("accountsErrorAlreadyRegistered"),
    errorSubmitFailed: t("accountsErrorSubmitFailed"),
  };

  return (
    <section className="accounts-screen" data-testid="accounts-screen">
      <h1>{t("accountsTitle")}</h1>
      <p className="accounts-lead">{t("accountsLead")}</p>

      {status !== undefined && isKnownAccountsStatus(status) ? (
        <p className="accounts-status" role="status" data-testid="accounts-status">
          {t(ACCOUNTS_STATUS_KEYS[status])}
        </p>
      ) : null}

      {/* THE RING EXPLANATION, BEFORE THE RING IS ASKED. */}
      <div className="accounts-explainer" data-testid="ring-explainer">
        <p>{t("ringExplainSpending")}</p>
        <p>{t("ringExplainSavings")}</p>
      </div>
      <p className="accounts-explainer-cards" data-testid="cards-not-here">
        {t("accountsCardsNotHere")}
      </p>

      <AccountSetupForm copy={copy} />

      {accounts.length === 0 ? (
        <p className="accounts-none" data-testid="accounts-none">
          {t("accountsNoneYet")}
        </p>
      ) : (
        <div className="accounts-registered">
          <h2>{t("accountsRegisteredTitle")}</h2>
          <ul className="accounts-list">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="accounts-list-row"
                data-testid="registered-account"
              >
                <span data-testid="registered-account-label">
                  {account.label}
                </span>
                <span className="accounts-list-bank">{account.bank}</span>
                {/* A CARD CARRIES NO ACCOUNT NUMBER (decision D-48): it is
                    listed by its label and its ring, which is what the
                    household can recognise it by. */}
                {/* NOT .pulse-amount. That class is the money treatment and
                    carries "no exceptions" in its own rule; an account
                    number is not an amount, and borrowing the class would
                    make the one rule about money mean something else. The
                    monospaced, slashed-zero rendering an account number
                    wants is its own class in the stylesheet. */}
                <span
                  className="accounts-list-number"
                  data-testid="registered-account-number"
                >
                  {account.iban ?? t("accountsCardNoNumber")}
                </span>
                {/* THE RING CORRECTION, and the only one v1 has. Refused
                    for an account that already carries its own imported
                    rows, with copy that says so (decision D-51). */}
                <form action={changeAccountRingAction} className="accounts-ring-form">
                  <input type="hidden" name="accountId" value={account.id} />
                  <span
                    className="accounts-list-ring"
                    data-testid="registered-account-ring"
                  >
                    {account.role === "POT"
                      ? t("ringSpending")
                      : t("ringSavings")}
                  </span>
                  <SubmitButton
                    name="ring"
                    value={account.role === "POT" ? "RESERVE" : "POT"}
                    className="accounts-ring-switch"
                    testId="switch-account-ring"
                  >
                    {account.role === "POT"
                      ? t("accountsMakeSavings")
                      : t("accountsMakeSpending")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
