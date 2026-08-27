import { requireHouseholdContext } from "@/platform/auth/context";
import { AccountsScreen } from "@/modules/accounts/ui";

// Thin route (pulse-frontend section 2): resolve the context, hand off to
// the accounts module's UI. English path only.

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const context = await requireHouseholdContext();
  const { status } = await searchParams;
  return <AccountsScreen context={context} status={status} />;
}
