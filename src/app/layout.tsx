import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse",
};

// THE PRESS LISTENER (M3-P9, plan step "ship the listener that raises the
// attribute", decision D-61).
//
// WHY THIS EXISTS AT ALL. The pressed appearance in src/app/globals.css is
// written twice, once for :active and once for [data-pressed]. Measured in
// the first implementation round under the chromium-phone project, across
// four touch input paths and sampling every animation frame: a held touch
// press produces ZERO frames in :active on a shipped control, and zero on a
// bare element outside the product, while a held mouse press in the same
// context produces both the state and a transform. A pressed appearance
// reached only through :active is reached by no finger. pointerdown fires on
// every touch path, so this listener raises the attribute those rules answer
// to, and hazard H9.11 is the phase merging as a stylesheet nothing ever
// triggers.
//
// WHY A SCRIPT AND NOT A CLIENT COMPONENT, which decision D-61 settles and
// which is not the implementer's to re-decide. A "use client" file would open
// the first React client boundary since src/platform/ui/nav-link.tsx:1, which
// is M3-P10's job and what hazard H9.5 exists to keep out; and a press
// listener that does not attach until the React bundle has hydrated is a poor
// answer to a complaint whose words are that nothing happens when the owner
// presses. This attaches at parse time. It is in the ROOT layout and not the
// authenticated shell because five of the nineteen controls live on the
// sign-in and sign-up screens, which src/app/(app)/layout.tsx never renders.
//
// NO INTERPOLATION, EVER (D-61's standing constraint). This constant carries
// no template expression, no token, no request value, no locale and no user
// input, so it has no injection surface. A later phase that needs a value
// inside it does not add one: it moves the listener to a client island and
// reopens D-61. The product declares no Content-Security-Policy today;
// src/middleware.ts is where one would land, and the phase that adds it adds
// a nonce for this script in the same change or turns criterion 9.9 red.
//
// THE MARKER IS data-press-feedback AND DELIBERATELY NOT data-testid. The
// rename landed in the plan amendment of 2026-08-24 on this phase's own
// escalation, and the reason is measured rather than stylistic: the
// pre-existing helper collectTestids at test/e2e/month-view.spec.ts:650
// sweeps every data-testid in the WHOLE document and then requires a
// non-zero bounding rect from everything it collects, while a script
// element computes display none and reports 0 by 0. Taken one attribute
// apart on the same head against the same server, that spec reported 1
// failed with the diff naming press-feedback and 1 passed with the
// attribute removed. Criterion 9.9(a) reads this marker out of the RAW
// RESPONSE BODY as text rather than through a Playwright locator, so any
// stable attribute serves it exactly as well and the rename costs nothing.
// The underlying defect in that helper is recorded in the plan's parked
// register for whichever phase next owns that file; criterion 9.7 pins
// this phase to one new file under test/e2e/, so it is not repaired here.
//
// WHAT THE DOCUMENT-WIDE CLEAR COSTS, taken deliberately (plan finding
// R2-07). A clear that sweeps the document also clears a press another finger
// is still holding, so with two touches on two controls the first release
// un-draws both. That failure is a press that DISAPPEARS, it corrects itself
// at the next press, and multitouch across two controls is rare here. The
// STICKING failure is the one that matters, and it is what the document-wide
// sweep and the pointercancel listener below prevent.
//
// THE POINTERCANCEL LISTENER IS NOT A NICETY. A scroll begun on a control IS
// a pointercancel, and on this product's month view a finger begins more
// scrolls on a control than it completes taps. Without it the control the
// reader scrolled from stays drawn pressed until something else is tapped,
// after which that control answers no further press because it is already in
// the pressed state.
const PRESS_FEEDBACK = `
(function () {
  var CONTROL =
    'button, a[href], summary, input[type="submit"], input[type="button"], [role="button"]';
  function clear() {
    document.querySelectorAll("[data-pressed]").forEach(function (marked) {
      marked.removeAttribute("data-pressed");
    });
  }
  document.addEventListener(
    "pointerdown",
    function (event) {
      var node = event.target;
      if (!node || typeof node.closest !== "function") {
        return;
      }
      var control = node.closest(CONTROL);
      if (control) {
        control.setAttribute("data-pressed", "");
      }
    },
    true,
  );
  document.addEventListener("pointerup", clear, true);
  document.addEventListener("pointercancel", clear, true);
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body>
        {children}
        <script
          data-press-feedback=""
          dangerouslySetInnerHTML={{ __html: PRESS_FEEDBACK }}
        />
      </body>
    </html>
  );
}
