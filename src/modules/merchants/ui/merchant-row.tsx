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

import {
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useState,
  useSyncExternalStore,
} from "react";
import { Amount } from "@/platform/ui/amount";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import { SubmitButton } from "@/platform/ui/submit-button";
import { Toast } from "@/platform/ui/toast";
import {
  enterNoticeQueue,
  isNoticeShowing,
  leaveNoticeQueue,
  noticeQueue,
  subscribeToNotices,
} from "./notice-queue";
import {
  claimNaming,
  forgetNaming,
  namingClaims,
  recordNaming,
  type NamingDirection,
} from "./naming-claims";

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

// The record that carries the server's answer back to the reader lives in
// ./naming-claims, which is a PURE module: its rules are the ones criterion
// 11.5 turns on, and test/app/naming-claims.test.ts exercises them in the
// fast gate rather than only through a browser. The rules, the two-row
// defect that shaped them and what they still cannot do are written at
// that module's definition.

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
  direction,
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
  // Which section this row is rendered in. The claim below must agree on
  // it: a merchant with groups on both sides renders two rows carrying the
  // same label, and without the direction a naming made on one side raises
  // its notice on the other (finding HZ-M3P11-02).
  readonly direction: NamingDirection;
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

  // ONE NOTICE ON SCREEN AT A TIME (fix round, finding HZ-M3P11-01). Every
  // notice is drawn in the same fixed rectangle, so a second one would
  // cover the first and the covered one would go unread, which is the harm
  // decision D-32 removed the timer to prevent. The queue in
  // ./notice-queue holds this row's place instead: a notice raised while
  // another is up waits and appears when the reader dismisses the one in
  // front, so nothing overlaps and nothing disappears undismissed. The
  // decision's own words, and why a shared host is not the fix here, are
  // quoted at that module's definition.
  const noticeId = useId();
  const showing = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) =>
        subscribeToNotices(noticeQueue, onStoreChange),
      [],
    ),
    () => isNoticeShowing(noticeQueue, noticeId),
    // On the server nothing is queued, so nothing is showing.
    () => false,
  );
  useEffect(() => {
    if (notice === null) {
      leaveNoticeQueue(noticeQueue, noticeId);
      return;
    }
    enterNoticeQueue(noticeQueue, noticeId);
    // A row that leaves the screen with a notice up must not hold the
    // queue closed behind it.
    return () => {
      leaveNoticeQueue(noticeQueue, noticeId);
    };
  }, [notice, noticeId]);

  const dismissNotice = useCallback(() => {
    leaveNoticeQueue(noticeQueue, noticeId);
    setNotice(null);
  }, [noticeId]);

  // THE CLAIM CHECK (criterion 11.5, hazard H11.5): a different answer is
  // not swapped in silently. It runs after every render on purpose, because
  // the refresh that carries the server's answer re-renders every row, and
  // it is idempotent: claimNaming retires the entry it answers. The rules
  // and their residues live at ./naming-claims.
  //
  // The comparison is made in the alphabet the SCREEN uses: the label this
  // row renders has been through maskCardNumbers, so the typed string is
  // rendered the same way before the two are compared (finding
  // HZ-M3P11-03). A name the masking rewrites therefore reads as the server
  // agreeing, which it did: the difference this notice is about is the
  // SERVER's answer differing, and the masking is a rendering rule this
  // screen applies to every label it draws.
  //
  // No dependency list ON PURPOSE, against the exhaustive-deps advice: the
  // merge case re-renders this row with an UNCHANGED label (only its total
  // moved), so a [label, unresolved] list would skip exactly the render
  // that carries the server's answer. The body cannot loop: claimNaming
  // retires the entry before this row raises anything.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const outcome = claimNaming(namingClaims, {
      direction,
      label,
      resolved: !unresolved,
      now: Date.now(),
      render: maskCardNumbers,
    });
    if (outcome === "differs") {
      setNotice({ kind: "differs" });
    }
  });

  const predicted = predictedLabel !== null;
  const rowUnresolved = unresolved && !predicted;

  // WHICH ROW THE NOTICE IS ABOUT (fix round, finding HZ-M3P11-05). The
  // notice is a descendant of this row but is drawn fixed at the bottom of
  // the viewport, so proximity tells a reader nothing about which row it
  // concerns. While it is up, the row points at it with aria-describedby,
  // which is the same mechanism the unconfirmed marking already uses.
  return (
    <li
      className={
        rowUnresolved ? "merchant-row merchant-row-unresolved" : "merchant-row"
      }
      data-testid={rowUnresolved ? "unresolved-group" : "merchant-group"}
      data-group-key={groupKey}
      {...(predicted ? { "data-unconfirmed": "" } : {})}
      {...(notice !== null && showing ? { "aria-describedby": noticeId } : {})}
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
            recordNaming(namingClaims, {
              rowKey: groupKey,
              direction,
              typed,
              at: Date.now(),
            });
            let result: NamingActionResult;
            try {
              result = await action(formData);
            } catch (error) {
              if (isRedirectSignal(error)) {
                // The SUCCESS path: the action revalidated and redirected,
                // and the framework signals that redirect as a rejection
                // with a NEXT_REDIRECT digest (measured in this phase's
                // verification-first probe). Rethrow so the router handles
                // it; this row's claim stays for the refreshed row to
                // answer.
                throw error;
              }
              // The TRANSPORT failure: the request never produced the
              // action's own answer. Revert is automatic (the optimistic
              // label dies with the transition); the notice is the loud
              // half (DR-0025). Only THIS row's claim is retired, never a
              // sibling's (finding HZ-M3P11-02).
              forgetNaming(namingClaims, groupKey);
              setNotice({ kind: "failed", message: copy.failed });
              return;
            }
            if (!result.ok) {
              // The DOMAIN refusal, reported as a value by the action.
              forgetNaming(namingClaims, groupKey);
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
            {/* THE DESCRIPTION HANGS ON A CONTROL THE READER CAN STILL
                REACH (fix round, finding CR-M3P11-02). Criterion 11.2(c)
                puts the unconfirmed description on the naming submit so a
                reader who moves focus back to the control they pressed is
                told again, and it is there. But that control is DISABLED
                for exactly the window the description exists, because
                M3-P10's busy state renders disabled while the form is in
                flight (criterion 10.3, a decided design this phase does
                not reverse), and a disabled button takes no keyboard
                focus. This field is not disabled, sits inside the same
                form, and carries the same description, so the second
                telling is reachable by keyboard as well as by a screen
                reader's virtual cursor. */}
            <input
              type="text"
              name="merchantName"
              placeholder={naming.placeholder}
              required
              {...(predicted ? { "aria-describedby": regionId } : {})}
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
      {notice === null || !showing ? null : notice.kind === "failed" ? (
        <Toast
          role="alert"
          message={notice.message}
          dismissLabel={copy.dismiss}
          testId="naming-failed"
          regionId={noticeId}
          onDismiss={dismissNotice}
        />
      ) : (
        <Toast
          role="status"
          message={copy.differs}
          dismissLabel={copy.dismiss}
          testId="naming-differs"
          regionId={noticeId}
          onDismiss={dismissNotice}
        />
      )}
    </li>
  );
};
