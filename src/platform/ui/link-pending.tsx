"use client";

import { useLinkStatus } from "next/link";

// THE NAVIGATION PENDING MARKER (M3-P10). A Link press starts a route
// transition and, on a route the router has not prefetched, the screen
// holds still until the payload arrives. This leaf is what changes in the
// meantime.
//
// WHY IT IS A CHILD OF THE LINK RATHER THAN THE LINK ITSELF. useLinkStatus
// reads the status of the nearest ancestor Link, so it must run in a
// DESCENDANT of one. That is what keeps src/modules/overview/ui/month-view.tsx
// and src/app/(app)/layout.tsx server components: they keep rendering the
// Link and add this leaf as its child, and no part of the month projection
// reaches the browser.
//
// THE VOCABULARY IS M3-P9's AND THIS FILE ADDS NO RULE. .pulse-busy is the
// second, equivalent route to the busy mark declared in src/app/globals.css,
// and it is the right one here rather than aria-busy: aria-busy on a link
// tells assistive technology to hold back the contents of the link, and the
// link's contents are not what is changing. The marker is aria-hidden
// because it says nothing a screen reader does not already get from the
// navigation itself.
//
// THE SIBLING THAT SHARES THIS MECHANISM is src/platform/ui/submit-button.tsx,
// which marks a submitting control with the attribute route to the same
// pseudo-element. A change to the mark belongs in the stylesheet, where both
// of them read it from.
//
// NO MINIMUM DURATION, for the same reason recorded in submit-button.tsx: a
// floor is a timer that keeps a marker on screen after the destination has
// rendered, and criterion 10.5 fails a marker left behind.
//
// THE MARKER IS data-link-pending AND DELIBERATELY NOT data-testid, for the
// reason M3-P9 recorded at src/app/layout.tsx for data-press-feedback: the
// helper collectTestids at test/e2e/month-view.spec.ts sweeps every
// data-testid in the document and then requires a non-zero bounding rect
// from everything it collects, so a transient marker in that sweep is a
// failure waiting for a race. Any stable attribute serves the spec here
// exactly as well.

export const LinkPending = () => {
  const { pending } = useLinkStatus();
  if (!pending) {
    return null;
  }
  return (
    <span className="pulse-busy" data-link-pending="" aria-hidden="true" />
  );
};
