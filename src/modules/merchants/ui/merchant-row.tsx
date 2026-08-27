"use client";

// THE PREDICTED ROW (M3-P11, DR-0025, decisions D-30 and D-31). The one
// client leaf in the merchants module: it owns a single group row's label
// and naming form and predicts with React's useOptimistic. It belongs to
// the module and not to src/platform/ui because it knows what a merchant
// group is (the placement test, pulse-frontend section 2).
//
// WHAT IS PREDICTED, and nothing else (decision D-31): the row's label
// becomes the string the reader typed, taken straight from the submitted
// form value with NO rule applied to it, and the row leaves the unresolved
// treatment. NOT predicted: the group's total and the two direction totals
// (a naming that merges into an existing merchant sums two totals in the
// use case, and predicting that means running a domain rule in the
// browser), the unresolved count (a projection over the household), the
// row's position (a domain sort), and the merge itself. While the server
// has not answered, the predicted label is MARKED: data-unconfirmed on the
// row for the visual half, and the unconfirmed copy inside a polite live
// region referenced by aria-describedby from the submit control for the
// non-visual half (decision D-30). aria-busy is NOT used on the row, the
// label or the region: it tells assistive technology to hold back the
// changes inside the element, which would suppress the announcement of the
// very change the marking describes. It stays on the submit control, where
// M3-P10 put it.
//
// EVERY STRING RENDERED HERE ARRIVES AS A PROP from the server component,
// the already-masked label and the notices' wording included: this file
// imports no message catalogue, no domain type and nothing outside
// src/platform/ui and React (criterion 11.7(e)). The action reference
// arrives as a prop for the same reason.

import { useEffect, useId, useOptimistic, useState } from "react";
import { Amount } from "@/platform/ui/amount";
import { SubmitButton } from "@/platform/ui/submit-button";
import { Toast } from "@/platform/ui/toast";

// The action's result, typed STRUCTURALLY rather than imported from the
// action module: the boundary rule keeps this leaf's import closure inside
// src/platform/ui and React, and the server component that binds the real
// action to this prop is where the compiler checks the two shapes agree.
type NamingActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly kind: string } };

export type NamingCopy = {
  // The unconfirmed marking's accessible text (the fourth catalogue key,
  // decision D-27 as amended).
  readonly unconfirmed: string;
  // The failure notice (DR-0026), used for the transport failure and for
  // any refusal kind the map below does not carry.
  readonly failed: string;
  // The notice that the saved name differs from the one typed.
  readonly differs: string;
  // The dismiss control's accessible label.
  readonly dismiss: string;
  // Refusal kinds that keep the specific wording M3-P12 gave them, so a
  // stale page is still told to reload rather than only that nothing was
  // saved. Keys are error kinds, values are catalogue values resolved by
  // the server component.
  readonly refusals: Readonly<Record<string, string>>;
};

// THE MOST RECENT SUCCESSFUL NAMING, module scope on purpose. RULE AT THE
// MECHANISM'S DEFINITION: a successful naming redirects and refreshes the
// review, which unmounts the predicting row (its key leaves the
// projection) and mounts or re-renders the row carrying the server's
// answer, so no single component instance ever sees both the typed and the
// stored name. This module-level record is the bridge: the submitting row
// writes it, and after the refresh every row runs the claim check below
// exactly once per render. It holds only what the reader themselves just
// typed, never an amount, and it never leaves the browser. Sibling
// implementations: none today; this is the product's first optimistic
// surface. If a second surface copies this mechanism, move the record and
// the claim rules somewhere both can share rather than duplicating them.
type RecentNaming = {
  readonly typed: string;
  readonly at: number;
};

let recentNaming: RecentNaming | null = null;

// A record nobody claimed within this window is stale and is dropped, so a
// much later unrelated mount can never claim it.
const RECENT_NAMING_WINDOW_MS = 30_000;

type Notice =
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "differs" };

const isRedirectSignal = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  "digest" in error &&
  typeof (error as { readonly digest?: unknown }).digest === "string" &&
  ((error as { readonly digest: string }).digest.startsWith("NEXT_REDIRECT"));

export const MerchantGroupRow = ({
  groupKey,
  label,
  countText,
  totalCents,
  unresolved,
  copy,
  naming,
  action,
}: {
  // The MASKED group key, for the row's stable DOM identity (data-group-key,
  // criterion 11.3): for an unresolved descriptor group the raw key IS the
  // descriptor, so an unmasked copy would reach spec failure messages and
  // retained traces for no gain.
  readonly groupKey: string;
  // The already-masked label the server rendered.
  readonly label: string;
  readonly countText: string;
  readonly totalCents: number;
  readonly unresolved: boolean;
  readonly copy: NamingCopy;
  readonly naming?: {
    // The counterparty IDENTITY KEY, unmasked, exactly as the rule subject
    // must be stored (M3-P12): it crosses as a hidden field value, never as
    // rendered text.
    readonly identityKey: string;
    readonly fieldLabel: string;
    readonly placeholder: string;
    readonly submitLabel: string;
  };
  readonly action?: (formData: FormData) => Promise<NamingActionResult>;
}) => {
  const regionId = useId();
  // The predicted label, null while nothing is in flight. Set inside the
  // form action (a transition), so React reverts it BY ITSELF the moment
  // the transition settles: on failure the server label below is what
  // renders again, with no bookkeeping to forget.
  const [predictedLabel, setPredictedLabel] = useOptimistic<string | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  // THE CLAIM CHECK (criterion 11.5, hazard H11.5): a different answer is
  // not swapped in silently. Runs after every render on purpose (the
  // refresh that carries the server's answer re-renders every row), and is
  // idempotent through the module record. The exact-match branch clears
  // the record silently: the server agreed with the prediction. The
  // trimmed-match branch marks the difference. String.prototype.trim here
  // is DETECTION AND ATTACHMENT, not prediction: the predicted label above
  // shows what was typed, untouched (decision D-31); this comparison only
  // finds the row now carrying the server's answer, because the projection
  // deliberately has no link from a merchant back to the key that was
  // named. The honest limit: if the use case ever stores something other
  // than the trimmed name, that new difference is not recognised here and
  // the label would change silently; criterion 11.5's deterministic
  // whitespace witness is the tripwire that stays green only while this
  // claim rule and the use case agree.
  // No dependency list ON PURPOSE, against the exhaustive-deps advice: the
  // merge case re-renders this row with an UNCHANGED label (only its total
  // moved), so a [label, unresolved] list would skip exactly the render
  // that carries the server's answer. The body cannot loop: it updates
  // state only after clearing the module record that gates it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (recentNaming === null) {
      return;
    }
    if (Date.now() - recentNaming.at > RECENT_NAMING_WINDOW_MS) {
      recentNaming = null;
      return;
    }
    if (label === recentNaming.typed) {
      // The server's answer equals the prediction character for character.
      recentNaming = null;
      return;
    }
    if (!unresolved && label === recentNaming.typed.trim()) {
      recentNaming = null;
      setNotice({ kind: "differs" });
    }
  });

  const predicted = predictedLabel !== null;
  const rowUnresolved = unresolved && !predicted;

  return (
    <li
      className={
        rowUnresolved ? "merchant-row merchant-row-unresolved" : "merchant-row"
      }
      data-testid={rowUnresolved ? "unresolved-group" : "merchant-group"}
      data-group-key={groupKey}
      {...(predicted ? { "data-unconfirmed": "" } : {})}
    >
      <span className="merchant-row-label" data-testid="group-label">
        {predictedLabel ?? label}
      </span>
      <span className="merchant-row-count">{countText}</span>
      <span data-testid="group-total">
        <Amount cents={totalCents} />
      </span>
      {naming !== undefined && action !== undefined ? (
        <form
          className="merchant-name-form"
          action={async (formData) => {
            const typed = String(formData.get("merchantName") ?? "");
            setPredictedLabel(typed);
            setNotice(null);
            recentNaming = { typed, at: Date.now() };
            let result: NamingActionResult;
            try {
              result = await action(formData);
            } catch (error) {
              if (isRedirectSignal(error)) {
                // The SUCCESS path: the action revalidated and redirected,
                // and the framework signals that redirect as a rejection
                // with a NEXT_REDIRECT digest (measured in this phase's
                // verification-first probe). Rethrow so the router handles
                // it; the module record above stays for the refreshed row
                // to claim.
                throw error;
              }
              // The TRANSPORT failure: the request never produced the
              // action's own answer. Revert is automatic (the optimistic
              // label dies with the transition); the notice is the loud
              // half (DR-0025).
              recentNaming = null;
              setNotice({ kind: "failed", message: copy.failed });
              return;
            }
            if (!result.ok) {
              // The DOMAIN refusal, reported as a value by the action.
              recentNaming = null;
              setNotice({
                kind: "failed",
                message: copy.refusals[result.error.kind] ?? copy.failed,
              });
            }
          }}
        >
          <input
            type="hidden"
            name="counterpartyText"
            value={naming.identityKey}
          />
          <label className="merchant-name-field">
            <span className="visually-hidden">{naming.fieldLabel}</span>
            <input
              type="text"
              name="merchantName"
              placeholder={naming.placeholder}
              required
            />
          </label>
          {/* The unconfirmed live region: ALWAYS in the tree, filled only
              while a prediction is on screen, so the copy is ANNOUNCED as
              it enters (a region inserted together with its text is not
              reliably announced, and text sitting in it from the start is
              never announced at all). Polite, because a prediction is not
              a failure; the assertive role belongs to the failure toast
              (decision D-32). */}
          <span
            role="status"
            id={regionId}
            className="visually-hidden"
            data-testid="unconfirmed-note"
          >
            {predicted ? copy.unconfirmed : null}
          </span>
          <SubmitButton
            className="merchant-name-button"
            {...(predicted ? { describedBy: regionId } : {})}
          >
            {naming.submitLabel}
          </SubmitButton>
        </form>
      ) : null}
      {notice === null ? null : notice.kind === "failed" ? (
        <Toast
          role="alert"
          message={notice.message}
          dismissLabel={copy.dismiss}
          testId="naming-failed"
          onDismiss={() => setNotice(null)}
        />
      ) : (
        <Toast
          role="status"
          message={copy.differs}
          dismissLabel={copy.dismiss}
          testId="naming-differs"
          onDismiss={() => setNotice(null)}
        />
      )}
    </li>
  );
};
