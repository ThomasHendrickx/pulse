import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/platform/auth/actions";
import { requireHouseholdContext } from "@/platform/auth/context";
import { getHousehold } from "@/platform/auth/household";
import { NavLink } from "@/platform/ui/nav-link";

// The authenticated shell. The household context is resolved once, here at
// the route boundary, and everything below receives it explicitly.
//
// The header nav lives HERE and only here (M3-P1 criterion 1.1, hazard
// H1.1): a route added later inherits it from the shell instead of
// shipping bare, which is the owner's original complaint. The literal
// data-testid values below are pinned to this file by the criterion's
// grep; NavLink receives them as props and adds only the active-route
// marker.
//
// TWO ROWS, PHONE FIRST (M3-P7, DR-0022, following
// delivery/design/mobile-v02/Main.dc.html:23 through :33): the identity
// row carries the brand, the household name and sign out; the navigation
// row below it gives the three links a third of the width each, so every
// target clears the tap-target minimum at 360 as well as at 390. The
// household identity keeps the ellipsis M3-P1 criterion 1.5 decided: it is
// the one element in the product allowed to give way. At the one
// breakpoint the two rows become one again.
//
// DOCUMENT ORDER IS CHOSEN FIRST AND THE DRAWING FOLLOWS IT (fix round,
// finding HZ-M3P7-05): identity, navigation, sign out. The sign-out form is
// drawn up on the identity row by grid placement, never by moving it up the
// document, because a keyboard or switch user meets this header in document
// order and the first control they meet should not be the destructive one.

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requireHouseholdContext();
  const household = await getHousehold(context);
  const t = await getTranslations();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-identity">
          <span className="pulse-eyebrow">Pulse</span>
          <span className="app-household" data-testid="household-context">
            {household.name}
          </span>
        </div>
        <nav className="app-nav" aria-label={t("navLabel")} data-testid="main-nav">
          <NavLink href="/" testId="nav-overview">
            {t("navOverview")}
          </NavLink>
          <NavLink href="/import" testId="nav-import">
            {t("navImport")}
          </NavLink>
          <NavLink href="/merchants" testId="nav-merchants">
            {t("navMerchants")}
          </NavLink>
        </nav>
        {/* READ AFTER THE NAVIGATION, DRAWN BESIDE THE IDENTITY (M3-P7 fix
            round, finding HZ-M3P7-05). The first version of this header put
            the sign-out form inside the identity row, which is where it is
            drawn, and the first Tab on every route in the product therefore
            landed on the one destructive control in the shell. Grid
            placement in the stylesheet draws it back up on that row. */}
        <form action={signOutAction}>
          <button type="submit" className="app-signout">
            {t("signout")}
          </button>
        </form>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
