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
  readonly errorSubmitFailed: string;
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

// WHAT THE FORM KNOWS THAT THE ACTION DOES NOT (fix round, finding
// HZ-M3P10-04). The action's own type carries the outcomes the SERVER can
// report. A submission that never reached the server, a connection dropped
// mid-post on the owner's phone, is not one of them: it is the client's
// knowledge, so it is a variant of the form's state and not of the action's
// contract.
type FormState = RegisterAccountsState | { readonly status: "failed" };

const INITIAL: FormState = { status: "idle" };

// A redirect is how this action reports SUCCESS, and the framework signals
// it by throwing. Reporting that as a failed submission would put an error
// on screen at the exact moment the registration worked, so it is re-thrown
// for the framework to handle and only everything else is caught.
const isRedirect = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  String((error as { readonly digest: unknown }).digest).startsWith(
    "NEXT_REDIRECT",
  );

export const AccountSetupForm = ({
  copy,
}: {
  readonly copy: AccountSetupCopy;
}) => {
  const [state, setState] = useState<FormState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<readonly Row[]>([emptyRow(0)]);
  const [nextKey, setNextKey] = useState(1);
  const fieldPrefix = useId();

  // The refusal, indexed by the row it belongs to. A submission-level
  // problem (no rows at all) has no row and renders above the list.
  const rowMessages = new Map<number, string>();
  let formMessage: string | undefined;
  if (state.status === "failed") {
    formMessage = copy.errorSubmitFailed;
  }
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
        // THE SECOND SUBMISSION IS REFUSED HERE (fix round, finding
        // HZ-M3P10-02). The control keeps its place in the tab order while
        // it is busy, so the keyboard can still activate it and this is the
        // guard that stops a second post. The stylesheet refuses the
        // pointer half.
        if (pending) {
          return;
        }
        const data = new FormData(event.currentTarget);
        // THE FAILURE PATH IS WRITTEN RATHER THAN LEFT TO THE FRAMEWORK
        // (fix round, finding HZ-M3P10-04). This transition drives both
        // aria-busy and the refusal on the submit control below. Before
        // this, a rejected call, which on a phone means a connection
        // dropped mid-submit, never reached setState and whether the busy
        // state ended was the framework's business rather than this file's.
        // With both branches written the transition ends either way, so the
        // control comes back by construction and the reader is told the
        // submission did not land instead of watching a mark loop forever.
        startTransition(async () => {
          try {
            setState(await registerAccountsAction(INITIAL, data));
          } catch (error) {
            if (isRedirect(error)) {
              throw error;
            }
            setState({ status: "failed" });
          }
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
      {/* THE BUSY STATE ON THIS ONE (M3-P10). This submit does NOT render
          through src/platform/ui/submit-button.tsx, and the reason is
          mechanical rather than a preference: useFormStatus reports the
          pending state of a form that was submitted THROUGH a form action,
          and this form deliberately uses an onSubmit handler and a
          transition instead (see the note above about React resetting a
          form after a form action resolves). So useFormStatus reports
          nothing here and the leaf would be inert. The transition's own
          pending flag is the same fact, and it drives the same vocabulary:
          aria-busy is what src/app/globals.css draws the busy mark from,
          and aria-disabled is what marks the refusal while leaving the
          control focusable, with the form's own onSubmit guard above
          refusing the second submission (fix round, finding HZ-M3P10-02:
          the disabled attribute this used to carry moved focus to
          document.body on every press). The sibling that shares this
          mechanism, and the file to change if the mark ever changes, is
          src/platform/ui/submit-button.tsx. */}
      <button
        type="submit"
        className="account-setup-submit"
        data-testid="register-accounts"
        aria-busy={pending ? "true" : "false"}
        aria-disabled={pending ? "true" : undefined}
      >
        {copy.submit}
      </button>
    </form>
  );
};
