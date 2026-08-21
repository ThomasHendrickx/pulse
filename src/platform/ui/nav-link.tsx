"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const active = pathname === href;
  return (
    <Link
      href={href}
      className="app-nav-link"
      data-testid={testId}
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      {children}
    </Link>
  );
};
