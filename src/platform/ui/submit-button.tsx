"use client";

import { useFormStatus } from "react-dom";

// THE ONE SUBMIT LEAF (M3-P10). Every submit control in the product that
// posts to a server action renders through here, and this file plus
// link-pending.tsx plus nav-link.tsx are the only "use client" files under
// src/platform/ui.
//
// WHY THE BOUNDARY IS HERE AND NOWHERE ELSE (pulse-frontend section 1,
// decision D-23). useFormStatus reports the pending state of the NEAREST
// ANCESTOR form, so this leaf needs no prop threaded down from the page and
// no state lifted out of it: every form, every row, every page and every
// layout that renders it stays a server component, and neither the month
// projection nor the merchant review projection reaches the browser to buy
// a busy state.
//
// WHAT MAY CROSS THE BOUNDARY, and it is the whole prop list: an
// already-translated label as children, a class name, a test id, the
// name/value pair a control uses to say which button was pressed, and,
// where a control overrides its form's action, that action reference. No
// message catalogue, no domain type, no projection and no household context
// crosses. Every user-facing string arrives server-rendered.
//
// THE BUSY STATE IS FORM-WIDE AND THAT IS A CHOICE, not an oversight
// (criterion 10.3, which allows either answer and forbids guessing).
//
// WHAT WAS MEASURED, because the plan required this question to be answered
// rather than assumed. Driving a real press on the one form in the product
// that has two submit controls
// (src/modules/import/ui/profile-confirmation.tsx) and reading useFormStatus
// out of both leaves at once:
//
//   pressed the overriding control (formAction prop present)
//     that leaf:  pending true, action identical to its formAction prop TRUE
//     other leaf: pending true, action identical to its (absent) prop FALSE
//
// So attribution IS reachable, and only in one direction: a control that
// OVERRIDES its form's action can recognise its own submission by comparing
// status.action with the action it was handed. A control that does not
// override has no action of its own to compare against, so it could only be
// attributed by threading the form's own action down into the leaf, which
// is a prop every caller would have to remember to pass and would silently
// mis-attribute if it forgot.
//
// THE CHOICE, AND THE ALTERNATIVE THAT WAS REJECTED. A local armed flag set
// in onClick goes stale: press A, let it settle, then press B, and A is
// still armed and lights up beside it. So the rule here is: while a form is
// in flight EVERY submit control in it is busy and none of them is
// pressable. That satisfies "the pressed control carries the busy
// affordance" and "no control in the form is pressable while it is in
// flight", it never lights up a control belonging to a press that is over,
// and it needs no prop a caller can forget. The cost is one extra mark on
// the one two-control form, whose second control sits inside a collapsed
// disclosure.
//
// THE MINIMUM VISIBLE DURATION, which the plan does not settle and which
// this leaf does (decision recorded in the phase work history). There is
// NONE, deliberately. A minimum-duration floor is a timer that holds a
// busy state on screen after the work is done, and this product's fast
// actions are redirects: the busy control is replaced by a new document
// rather than flickering back to rest in place, so the glitch a floor
// guards against does not occur here. The busy MARK fades in over
// --duration-state rather than snapping (the opacity transition on the
// control), which is what keeps a 40ms round trip from reading as a flash,
// and it costs no timer and no state.
//
// THE OTHER HALF OF THE STATE VOCABULARY LIVES IN THE STYLESHEET, and the
// sibling that shares this mechanism is named there rather than only here:
// src/app/globals.css [aria-busy="true"] draws the mark as a
// pseudo-element, so this leaf adds no markup, no class and no copy. Its
// sibling implementation is src/platform/ui/link-pending.tsx, which marks a
// navigating control with the same vocabulary through .pulse-busy.
//
// NOTHING IS PREDICTED HERE (criterion 10.10, decision D-22). This leaf
// acknowledges the press. The optimistic update DR-0025 decided, and the
// toast DR-0026 requires under it, are M3-P11's and they layer over this.

export const SubmitButton = ({
  className,
  testId,
  name,
  value,
  formAction,
  describedBy,
  children,
}: {
  readonly className?: string;
  readonly testId?: string;
  readonly name?: string;
  readonly value?: string;
  readonly formAction?: (formData: FormData) => void | Promise<void>;
  // M3-P11: the id of an element describing this control's current state,
  // wired to aria-describedby. The merchant naming control points it at the
  // row's unconfirmed live region while a prediction is on screen, so a
  // reader who moves focus back to the control they pressed is told the
  // value beside it is not stored yet (criterion 11.2(c), decision D-30).
  readonly describedBy?: string;
  readonly children: React.ReactNode;
}) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending ? "true" : undefined}
      {...(className === undefined ? {} : { className })}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      {...(name === undefined ? {} : { name })}
      {...(value === undefined ? {} : { value })}
      {...(formAction === undefined ? {} : { formAction })}
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
    >
      {children}
    </button>
  );
};
