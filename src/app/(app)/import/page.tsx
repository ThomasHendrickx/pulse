import { redirect } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import { listAccounts } from "@/modules/accounts/application";
import { UploadForm } from "@/modules/import/ui";

// Thin route (pulse-frontend section 2): resolve the context, hand off to
// the import module's UI.
//
// SETUP COMES FIRST (M3-P14). A household that has registered NOTHING is
// sent to the accounts screen before this screen will accept a file. That
// is what keeps the simple world simple: accounts used to be discovered one
// statement at a time, and every account a statement had not yet introduced
// was offered as a merchant. The redirect is on the empty case only, so a
// household that has completed setup and later buys a card is never sent
// back here.

export default async function ImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const context = await requireHouseholdContext();
  const accounts = await listAccounts(context);
  if (accounts.length === 0) {
    redirect("/accounts");
  }
  const { status } = await searchParams;
  return <UploadForm status={status} />;
}
