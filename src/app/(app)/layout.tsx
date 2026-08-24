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
// row below it shares its width equally between the links, so every target
// clears the tap-target minimum at 360 as well as at 390.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, M3-P14). This paragraph
// said "gives the THREE links a third of the width each". M3-P14 adds a
// fourth, so both the count and the fraction were false the moment that
// link landed. The stylesheet distributes the row rather than hard-coding a
// fraction; what is pinned is the tap-target floor and the rendered line
// count, and criterion 14.7 measures both. The
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
          {/* THE FOURTH LINK (M3-P14). The row was sized for three at a
              third of the width each; four now share it. The label is short
              in all three catalogues on purpose, and the width witness in
              test/e2e/month-view.spec.ts measures every link's rendered line
              count and border box at 390 and 360 and at the 150 and 200
              percent text scales against the baseline captured before this
              link existed, because a fourth link changes width and not
              height and the existing instruments are blind to that. */}
          <NavLink href="/accounts" testId="nav-accounts">
            {t("navAccounts")}
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
