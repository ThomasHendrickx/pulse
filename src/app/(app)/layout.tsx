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

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requireHouseholdContext();
  const household = await getHousehold(context);
  const t = await getTranslations();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="pulse-eyebrow">Pulse</span>
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
        <span className="app-household" data-testid="household-context">
          {household.name}
        </span>
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
