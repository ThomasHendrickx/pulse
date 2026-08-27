"use client";

// THE HAND-BUILT TOAST (M3-P11, DR-0026, decision D-32). One presentational
// notice, anchored to the bottom of the viewport, that knows nothing about
// merchants or any other domain: the message, the dismiss label and the
// live-region role all arrive as props from a server component, so this
// file imports no message catalogue and no domain type (the platform/ui
// placement test: this component may not know what a transaction is).
//
// Built by hand because CLAUDE.md scope discipline forbids a component
// library, and a toast is not a reason to add one.
//
// IT HAS NO TIMER, and that is the point rather than an omission (decision
// D-32): a transient notice that is missed leaves no trace, and a reverted
// value on a screen full of figures then reads as a value the reader
// entered themselves. The notice stays until the reader presses the real
// dismiss control below. The cost, accepted in D-32: an undismissed notice
// occupies the bottom of a phone screen until dealt with, which is why the
// dismiss control clears --tap-target-min and why the page scrolls behind
// the notice.
//
// THE LIVE REGION IS PART OF THE MECHANISM, not a polish: a failure is
// announced assertively (role="alert") and a non-failing difference is
// announced politely (role="status"), because a reader who is not looking
// at that corner of the screen is exactly the reader DR-0026 exists to
// protect. The role arrives as a prop because the caller knows which kind
// of news it carries; this component only insists it is one of the two.
// Announcement works by INSERTION: the caller mounts this component when
// the news arrives, and the browser announces the freshly inserted live
// region's content.
//
// Its appearance lives in src/app/globals.css (.pulse-toast rules) on
// M3-P9's tokens: the entrance transition uses --duration-state, so the
// reduced-motion block that zeroes the durations at :root makes it appear
// at once, with no separate rule to remember. The dismiss control is a
// real button, so it inherits the pressed appearance M3-P9 ships for
// button:active and [data-pressed] and the focus ring the base styles draw.

export const Toast = ({
  role,
  message,
  dismissLabel,
  testId,
  onDismiss,
}: {
  readonly role: "alert" | "status";
  readonly message: string;
  readonly dismissLabel: string;
  readonly testId?: string;
  readonly onDismiss: () => void;
}) => (
  <div className="pulse-toast" role={role}>
    <p
      className="pulse-toast-message"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {message}
    </p>
    <button type="button" className="pulse-toast-dismiss" onClick={onDismiss}>
      {dismissLabel}
    </button>
  </div>
);
