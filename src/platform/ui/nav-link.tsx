"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "./link-pending";

// The shell nav's one client island, pushed to the leaf (pulse-frontend
// section 1). The reason for "use client": the active-route marker must
// follow client-side navigations, and the App Router keeps the shell
// layout mounted across them, so a server-computed marker would go stale
// after the first click; usePathname is the supported way to read the
// current route. Everything else about the nav (the labels from the
// catalogs, the data-testid values, the routes) is decided by the server
// layout and arrives here as props: criterion 1.1 pins the nav's testids
// to src/app/(app)/layout.tsx and nowhere else, which is why this file
// carries no literal testid and no copy.
//
// A platform/ui primitive by the section 2 test: it knows an href and a
// label, not what a transaction is.

// Section membership, not string equality (fix round, finding CR-601):
// the confirm and result steps live on /import/<id>, and an exact match
// left NO link current on them. A non-root href is current for its exact
// path and for any sub-path below it (href plus "/"); the root href "/"
// stays exact-match only, because under the prefix rule it would be
// current on every route. Sibling that must stay in step: the CSS state
// selector .app-nav-link[aria-current="page"] in src/app/globals.css
// styles whatever this computes; the e2e sub-route test is the witness.
const isCurrentRoute = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

export const NavLink = ({
  href,
  testId,
  children,
}: {
  readonly href: string;
  readonly testId: string;
  readonly children: React.ReactNode;
}) => {
  const pathname = usePathname();
  const active = isCurrentRoute(pathname, href);
  return (
    <Link
      href={href}
      className="app-nav-link"
      data-testid={testId}
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      {children}
      {/* THE PENDING MARKER (M3-P10). useLinkStatus must run in a
          DESCENDANT of the Link, which is why it is a child here and not
          a prop. The three shell links and the accounts link all get it
          from this one place. */}
      <LinkPending />
    </Link>
  );
};
