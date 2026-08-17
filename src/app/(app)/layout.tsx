import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/platform/auth/actions";
import { requireHouseholdContext } from "@/platform/auth/context";
import { getHousehold } from "@/platform/auth/household";

// The authenticated shell. The household context is resolved once, here at
// the route boundary, and everything below receives it explicitly.

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
        <span data-testid="household-context">{household.name}</span>
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
