import { requireHouseholdContext } from "@/platform/auth/context";
import { previewDeclarationChange } from "@/modules/ledger/application";
import {
  listAccountsWithImportState,
  previewAccountRingChange,
} from "@/modules/accounts/application";
import { AccountsScreen } from "@/modules/accounts/ui";
import type { AccountsScreenData } from "@/modules/accounts/ui";

// THE ACCOUNTS ROUTE (M3-P14). Reached from the shell's navigation row and
// from the month view's empty state, because a household with no imports is
// exactly when registering the accounts it owns is most useful.
//
// A ROUTE THAT COMPOSES AND RENDERS, and nothing else: the household context
// is resolved once at the shell boundary and arrives here, the reads are the
// accounts module's published ones, and every decision lives in a use case
// (pulse-frontend section 1).

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireHouseholdContext();
  const raw = await searchParams;
  const single = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === "string" ? value : undefined;
  };
  const accounts = await listAccountsWithImportState(context);
  // WHAT EACH CORRECTION WOULD MOVE, computed before the owner confirms
  // (criterion 15.7) by the dry run the ledger publishes. Sequential rather
  // than parallel: each is a whole-household read, and a household has a
  // handful of accounts, not thousands.
  const rows: AccountsScreenData["accounts"][number][] = [];
  for (const account of accounts) {
    const target = account.role === "POT" ? "RESERVE" : "POT";
    const preview = await previewAccountRingChange(
      context,
      { accountId: account.id, role: target },
      { preview: previewDeclarationChange },
    );
    rows.push({
      account,
      hasImport: account.hasImport,
      preview: preview.ok ? preview.value : null,
    });
  }
  const status = single("status");
  return (
    <AccountsScreen
      data={{ accounts: rows }}
      {...(status === undefined ? {} : { status })}
      params={{
        label: single("label") ?? "",
        country: single("country") ?? "",
        expected: single("expected") ?? "",
        actual: single("actual") ?? "",
        rules: single("rules") ?? "0",
      }}
    />
  );
}
