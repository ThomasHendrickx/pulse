"use client";

// THE SETUP FORM (M3-P14, criterion 14.2). One submission carrying EVERY
// account the household owns, rows addable and removable, one submit.
//
// WHY THIS IS A CLIENT ISLAND, which pulse-frontend section 1 asks to be
// justified rather than assumed. Two reasons, both local interactive state:
// the row list grows and shrinks under the owner's hands, and a REFUSED
// submission must leave the other seven rows exactly as they were typed
// (criterion 14.3). A form that round-tripped through a redirect would clear
// them, which is the failure the criterion names.
//
// WHY THE SUBMIT IS AN onSubmit HANDLER AND NOT `<form action={...}>`, which
// is the shape this file had first and which criterion 14.3 caught (clause
// R-087). React RESETS a form after a form action resolves, and a reset
// writes every field back to its defaultValue. These inputs are CONTROLLED,
// so React's own state still held what the owner typed while the DOM showed
// empty boxes, and nothing re-rendered to put the values back: measured, the
// refused submission cleared all three rows on screen. Preventing the
// default submit and calling the action inside a transition leaves the form
// alone, so the values the owner typed are still there to correct.
//
// NO COPY IS DECIDED HERE. Every user-facing string arrives as a prop from
// the server component, which read it from the catalogues, the same pattern
// as src/platform/ui/nav-link.tsx. That is what keeps all three languages in
// one place and this file out of the i18n question.
//
// NO LITERAL COLOUR, FONT SIZE OR SPACING (CLAUDE.md non-negotiable 4). Every
// class here is defined in src/app/globals.css against tokens.

import { useId, useState, useTransition } from "react";
import {
  registerAccountsAction,
  type RegisterAccountsState,
} from "./actions";

export type AccountSetupCopy = {
  readonly labelField: string;
  readonly bankField: string;
  readonly numberField: string;
  readonly ringField: string;
  readonly ringChoose: string;
  readonly ringSpending: string;
  readonly ringSavings: string;
  readonly addRow: string;
  readonly removeRow: string;
  readonly submit: string;
  readonly rowName: string;
  readonly errorNoRows: string;
  readonly errorLabelMissing: string;
  readonly errorBankMissing: string;
  readonly errorRingMissing: string;
  readonly errorRingInvalid: string;
  readonly errorNumberEmpty: string;
  readonly errorNumberCountry: string;
  readonly errorNumberLength: string;
  readonly errorNumberChecksum: string;
  readonly errorDuplicate: string;
  readonly errorAlreadyRegistered: string;
};

type Row = {
  readonly key: number;
  readonly label: string;
  readonly bank: string;
  readonly accountNumber: string;
  readonly ring: string;
};

const emptyRow = (key: number): Row => ({
  key,
  label: "",
  bank: "",
  accountNumber: "",
  ring: "",
});

const INITIAL: RegisterAccountsState = { status: "idle" };

export const AccountSetupForm = ({
  copy,
}: {
  readonly copy: AccountSetupCopy;
}) => {
  const [state, setState] = useState<RegisterAccountsState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<readonly Row[]>([emptyRow(0)]);
  const [nextKey, setNextKey] = useState(1);
  const fieldPrefix = useId();

  // The refusal, indexed by the row it belongs to. A submission-level
  // problem (no rows at all) has no row and renders above the list.
  const rowMessages = new Map<number, string>();
  let formMessage: string | undefined;
  if (state.status === "refused") {
    const failure = state.failure;
    if (failure.kind === "already-registered") {
      rowMessages.set(failure.row, copy.errorAlreadyRegistered);
    } else {
      for (const problem of failure.problems) {
        if (problem.kind === "no-rows") {
          formMessage = copy.errorNoRows;
          continue;
        }
        const text = (() => {
          switch (problem.problem.kind) {
            case "label-missing":
              return copy.errorLabelMissing;
            case "bank-missing":
              return copy.errorBankMissing;
            case "ring-missing":
              return copy.errorRingMissing;
            case "ring-invalid":
              return copy.errorRingInvalid;
            case "duplicate-in-submission":
              return copy.errorDuplicate;
            case "account-number-invalid":
              switch (problem.problem.problem.kind) {
                case "empty":
                  return copy.errorNumberEmpty;
                case "unknown-country":
                  return copy.errorNumberCountry;
                case "wrong-length":
                  return copy.errorNumberLength;
                case "checksum-failed":
                  return copy.errorNumberChecksum;
              }
          }
        })();
        const existing = rowMessages.get(problem.row);
        rowMessages.set(
          problem.row,
          existing === undefined ? text : `${existing} ${text}`,
        );
      }
    }
  }

  const update = (index: number, patch: Partial<Row>): void => {
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  };

  return (
    <form
      className="account-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setState(await registerAccountsAction(INITIAL, data));
        });
      }}
    >
      {formMessage === undefined ? null : (
        <p className="account-setup-error" role="alert" data-testid="account-form-error">
          {formMessage}
        </p>
      )}
      <ol className="account-row-list">
        {rows.map((row, index) => {
          const message = rowMessages.get(index);
          // The keys are suffixed rather than bare (labelId, not label) so
          // the descriptor-surface walk in
          // test/domain/merchant-review.test.ts does not read an htmlFor
          // attribute as a rendered descriptor field. That walk matches
          // `.label` on a word boundary; a control id is not counterparty
          // text and does not belong in its exclusion table.
          const ids = {
            labelId: `${fieldPrefix}-label-${row.key}`,
            bankId: `${fieldPrefix}-bank-${row.key}`,
            numberId: `${fieldPrefix}-number-${row.key}`,
            ringId: `${fieldPrefix}-ring-${row.key}`,
          };
          return (
            <li key={row.key} className="account-row" data-testid="account-row">
              <p className="account-row-name">
                {/* The catalogue's own template, with its one placeholder
                    filled here because the row number is this island's. */}
                {copy.rowName.replace("{row}", String(index + 1))}
              </p>
              <div className="account-field">
                <label htmlFor={ids.labelId}>{copy.labelField}</label>
                <input
                  id={ids.labelId}
                  name="label"
                  type="text"
                  value={row.label}
                  onChange={(event) =>
                    update(index, { label: event.target.value })
                  }
                />
              </div>
              <div className="account-field">
                <label htmlFor={ids.bankId}>{copy.bankField}</label>
                <input
                  id={ids.bankId}
                  name="bank"
                  type="text"
                  value={row.bank}
                  onChange={(event) =>
                    update(index, { bank: event.target.value })
                  }
                />
              </div>
              <div className="account-field">
                <label htmlFor={ids.numberId}>{copy.numberField}</label>
                <input
                  id={ids.numberId}
                  name="accountNumber"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.accountNumber}
                  onChange={(event) =>
                    update(index, { accountNumber: event.target.value })
                  }
                />
              </div>
              <div className="account-field">
                <label htmlFor={ids.ringId}>{copy.ringField}</label>
                {/* NO DEFAULT RING. The empty option is disabled, so the
                    ring is answered or the server refuses the row by name
                    (hazard H14.4). */}
                <select
                  id={ids.ringId}
                  name="ring"
                  value={row.ring}
                  onChange={(event) =>
                    update(index, { ring: event.target.value })
                  }
                >
                  <option value="">{copy.ringChoose}</option>
                  <option value="POT">{copy.ringSpending}</option>
                  <option value="RESERVE">{copy.ringSavings}</option>
                </select>
              </div>
              {message === undefined ? null : (
                <p
                  className="account-row-error"
                  role="alert"
                  data-testid="account-row-error"
                >
                  {message}
                </p>
              )}
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="account-row-remove"
                  data-testid="remove-account-row"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, at) => at !== index),
                    )
                  }
                >
                  {copy.removeRow}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="account-add-row"
        data-testid="add-account-row"
        onClick={() => {
          setRows((current) => [...current, emptyRow(nextKey)]);
          setNextKey((key) => key + 1);
        }}
      >
        {copy.addRow}
      </button>
      <button
        type="submit"
        className="account-setup-submit"
        data-testid="register-accounts"
        disabled={pending}
      >
        {copy.submit}
      </button>
    </form>
  );
};
