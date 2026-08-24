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
  // WHAT THE CORRECTION WOULD MOVE, computed before the owner confirms
  // (criterion 15.7) by the DRY RUN the ledger publishes, and computed for
  // ONE account: the one whose control the owner has just asked about.
  //
  // ONE AND NOT ALL, and the reason is measured rather than aesthetic. A
  // preview is a dry run of the whole interpretation over the whole
  // household, so a preview per row costs one full interpretation per
  // account on every render of this page. Measured in dev while building
  // this: 1.9 seconds with one account and 3.7 with five, growing with each
  // registration, against a household that is going to register ten. The
  // guarantee is unchanged; only the moment it is computed moved.
  const previewFor = (() => {
    const requested = single("preview");
    return requested === undefined ? null : requested;
  })();
  const rows: AccountsScreenData["accounts"][number][] = [];
  for (const account of accounts) {
    const target = account.role === "POT" ? "RESERVE" : "POT";
    const preview =
      account.id === previewFor
        ? await previewAccountRingChange(
            context,
            { accountId: account.id, role: target },
            { preview: previewDeclarationChange },
          )
        : null;
    rows.push({
      account,
      hasImport: account.hasImport,
      preview: preview !== null && preview.ok ? preview.value : null,
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
