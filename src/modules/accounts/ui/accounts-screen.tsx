import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { HouseholdContext } from "@/platform/tenancy";
import { formatCents } from "@/platform/ui/amount";
import type { AccountRecord, RingChangeMovement } from "../application";
import { correctAccountRingAction, registerAccountAction } from "./actions";
import { ACCOUNT_STATUS_KEYS, isKnownAccountStatus } from "./status-keys";

// THE ACCOUNTS SCREEN (M3-P14). The household registers every account it
// owns, in either ring, WITHOUT importing a statement for it, so that a
// transfer to one of its own accounts is classified as its own account
// instead of being offered as a merchant to name. That is the owner's
// scenario, and until this screen existed an account could only come into
// being by importing a file for it.
//
// Server components only. The whole screen is a projection of one read plus
// two server actions; there is no client state here (pulse-frontend
// sections 1 and 2).
//
// NO LITERAL COLOUR, FONT SIZE OR SPACING appears in this file or in the
// route beside it. Everything visual is a class in src/app/globals.css whose
// every value is a token from styles/tokens.css.

export type AccountsScreenData = {
  readonly accounts: readonly {
    readonly account: AccountRecord;
    readonly hasImport: boolean;
    readonly preview: RingChangeMovement | null;
  }[];
};

const StatusLine = async ({
  status,
  params,
}: {
  readonly status: string;
  readonly params: Record<string, string>;
}) => {
  const t = await getTranslations();
  if (!isKnownAccountStatus(status)) {
    return null;
  }
  const key = ACCOUNT_STATUS_KEYS[status];
  const good = status === "registered" || status === "ring-corrected";
  const rules = Number(params.rules ?? "0");
  return (
    <div data-testid="accounts-status">
      <p className={good ? "account-notice" : "account-error"}>
        {t(key, {
          label: params.label ?? "",
          country: params.country ?? "",
          expected: params.expected ?? "",
          actual: params.actual ?? "",
        })}
      </p>
      {/* A NAMING THAT STOPS APPLYING IS COUNTED AND NAMED, NEVER SILENTLY
          GONE (decision D-49, criteria 14.13 and 15.6). The rule itself is
          KEPT: recompute may never write to the declarations layer, and a
          rule left standing starts matching again by itself the moment the
          ring is put right, while a deleted one is gone. What the household
          must not have is a decision of theirs that vanished with no word. */}
      {good && rules > 0 ? (
        <p className="account-notice" data-testid="accounts-rules-stopped">
          {t("accountsRulesStopped", {
            count: rules,
            label: params.label ?? "",
          })}
        </p>
      ) : null}
    </div>
  );
};

// WHAT WILL MOVE, BEFORE THE OWNER CONFIRMS (criterion 15.7). Three
// quantities and not one, because a correction OUT of the pot makes TWO
// movements over TWO DIFFERENT SETS OF ROWS: the rows ON the account are
// cleared and stop being counted at all, while the reserves block gains the
// counterparty rows on the household's OTHER pot accounts. Every figure here
// comes from a DRY RUN of the same interpretation the recompute runs, over
// the proposed declaration set, writing nothing (decision D-58).
const RingPreview = async ({ preview }: { readonly preview: RingChangeMovement }) => {
  const t = await getTranslations();
  const lines: string[] = [];
  if (preview.rowsOnAccountDirection === "stop-counting") {
    lines.push(t("accountsCorrectRowsStop", { count: preview.rowsOnAccount }));
  } else if (preview.rowsOnAccountDirection === "start-counting") {
    lines.push(t("accountsCorrectRowsStart", { count: preview.rowsOnAccount }));
  }
  if (preview.spendDeltaCents < 0) {
    lines.push(
      t("accountsCorrectSpendFalls", {
        amount: formatCents(0 - preview.spendDeltaCents),
      }),
    );
  } else if (preview.spendDeltaCents > 0) {
    lines.push(
      t("accountsCorrectSpendRises", {
        amount: formatCents(preview.spendDeltaCents),
      }),
    );
  }
  if (preview.incomeDeltaCents < 0) {
    lines.push(
      t("accountsCorrectIncomeFalls", {
        amount: formatCents(0 - preview.incomeDeltaCents),
      }),
    );
  } else if (preview.incomeDeltaCents > 0) {
    lines.push(
      t("accountsCorrectIncomeRises", {
        amount: formatCents(preview.incomeDeltaCents),
      }),
    );
  }
  if (preview.reservesDeltaCents > 0) {
    lines.push(
      t("accountsCorrectReservesRises", {
        amount: formatCents(preview.reservesDeltaCents),
      }),
    );
  } else if (preview.reservesDeltaCents < 0) {
    lines.push(
      t("accountsCorrectReservesFalls", {
        amount: formatCents(0 - preview.reservesDeltaCents),
      }),
    );
  }
  if (preview.merchantRulesStoppedMatching > 0) {
    lines.push(
      t("accountsCorrectRulesStop", {
        count: preview.merchantRulesStoppedMatching,
      }),
    );
  }
  return (
    <p className="account-preview" data-testid="ring-change-preview">
      {/* A CORRECTION THAT WOULD MOVE NOTHING SAYS SO rather than showing a
          bare zero with no explanation. */}
      {lines.length === 0 ? t("accountsCorrectNothingMoves") : lines.join(" ")}
    </p>
  );
};

export const AccountsScreen = async ({
  data,
  status,
  params,
}: {
  readonly context?: HouseholdContext;
  readonly data: AccountsScreenData;
  readonly status?: string;
  readonly params: Record<string, string>;
}) => {
  const t = await getTranslations();
  return (
    <div className="accounts-screen" data-testid="accounts-screen">
      <header className="month-header">
        <div className="month-header-left">
          <div className="month-title-row">
            <h1 data-testid="accounts-title">{t("accountsTitle")}</h1>
          </div>
        </div>
      </header>

      {status === undefined ? null : (
        <StatusLine status={status} params={params} />
      )}

      <section className="month-card" data-testid="accounts-list">
        <header className="month-card-header">
          <div>
            <h2>{t("accountsTitle")}</h2>
          </div>
        </header>
        <p className="month-note">{t("accountsIntro")}</p>
        {data.accounts.length === 0 ? (
          <p className="month-note" data-testid="accounts-empty">
            {t("accountsEmpty")}
          </p>
        ) : (
          <ul className="month-list">
            {data.accounts.map(({ account, hasImport, preview }) => {
              const held = account.role === "RESERVE";
              const other = held ? "POT" : "RESERVE";
              return (
                <li
                  key={account.id}
                  className="month-row"
                  data-testid="account-row"
                  data-ring={account.role}
                >
                  <span className="month-group-label account-row-lines">
                    <span>{account.label}</span>
                    {/* THE STATE AS WORDS, WITH NO NUMBER THAT LOOKS LIKE A
                        TOTAL (criterion 14.15 witness TWO, decision D-60).
                        A held account says its statements are kept and
                        counted in no month, with NO accumulated count and NO
                        amount, so nothing on this screen can be read as how
                        much is in savings. The per-period count lives on the
                        month view, where a month is what is being shown. */}
                    <span className="account-row-state" data-testid="account-ring-state">
                      {held
                        ? t("accountsRingReserveMeaning")
                        : t("accountsRingPotMeaning")}
                    </span>
                    <span className="account-row-state" data-testid="account-bank">
                      {account.bank}
                      {" · "}
                      {hasImport
                        ? t("accountsImported")
                        : t("accountsNotImported")}
                    </span>
                  </span>
                  <span className="month-row-meta" data-testid="account-ring">
                    {held ? t("accountsRingReserve") : t("accountsRingPot")}
                  </span>
                  {preview === null ? null : <RingPreview preview={preview} />}
                  {/* THE RING CORRECTION CONTROL (M3-P15, criterion 15.9).
                      M3-P14's import copy names this control as the remedy
                      for a ring answered the wrong way, and a release in
                      which that copy pointed at nothing would be worse than
                      no copy. It is a declaration edit followed by a
                      recompute; it writes no transaction row. */}
                  <form
                    action={correctAccountRingAction}
                    className="account-ring-form"
                  >
                    <input type="hidden" name="accountId" value={account.id} />
                    <input type="hidden" name="ring" value={other} />
                    <button
                      type="submit"
                      data-testid="correct-ring"
                      data-account-id={account.id}
                      data-target-ring={other}
                    >
                      {t("accountsCorrectSubmit", {
                        ring:
                          other === "RESERVE"
                            ? t("accountsRingReserve")
                            : t("accountsRingPot"),
                      })}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="month-card" data-testid="accounts-register">
        <header className="month-card-header">
          <div>
            <h2>{t("accountsRegisterTitle")}</h2>
          </div>
        </header>
        <p className="month-note">{t("accountsRegisterBody")}</p>
        {/* THE CARD CASE IS STATED, NOT PAPERED OVER (decision D-48). A card
            account carries no account number by design and is recognised
            through its bound source profile at import time, so a
            pre-registered card would have no identifier for the import path
            to adopt it by and would become a second account. There is no
            control below that submits an account without a number: the
            duplicate hazard is closed by construction. */}
        <p className="month-note" data-testid="accounts-card-note">
          {t("accountsCardNote")}
        </p>
        <form action={registerAccountAction} className="account-ring-form">
          <label className="import-field">
            <span>{t("accountsLabelField")}</span>
            <input type="text" name="label" required data-testid="account-label" />
          </label>
          <label className="import-field">
            <span>{t("accountsBankField")}</span>
            <input type="text" name="bank" required data-testid="account-bank-field" />
          </label>
          <label className="import-field">
            <span>{t("accountsNumberField")}</span>
            <input
              type="text"
              name="accountNumber"
              required
              spellCheck={false}
              data-testid="account-number"
            />
          </label>
          <label className="import-field">
            <span>{t("accountsRingField")}</span>
            <select name="ring" required defaultValue="" data-testid="account-ring-field">
              <option value="" disabled />
              <option value="POT">{t("accountsRingPot")}</option>
              <option value="RESERVE">{t("accountsRingReserve")}</option>
            </select>
          </label>
          <button type="submit" data-testid="register-account">
            {t("accountsSubmit")}
          </button>
        </form>
      </section>

      <p className="month-account-link">
        <Link href="/" data-testid="accounts-back">
          {t("backToMonth")}
        </Link>
      </p>
    </div>
  );
};
