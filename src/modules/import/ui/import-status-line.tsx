import Link from "next/link";
import { LinkPending } from "@/platform/ui/link-pending";
import { getTranslations } from "next-intl/server";
import { IMPORT_STATUS_KEYS, isKnownImportStatus, type KnownImportStatus } from "./status-keys";

// Localized status line for the import screens, driven by whitelisted
// ?status= values. Unknown values render nothing.
//
// TWO STATUSES CARRY A LINK (M3-P14, criterion 14.5). A refusal that names
// the setup screen without a way to reach it is copy that describes an
// action instead of offering it, which is the same defect the empty state
// fixed in M3-P1. The link target is a route, not translated content: URL
// paths are English only.
const SETUP_LINKED: ReadonlySet<KnownImportStatus> = new Set<KnownImportStatus>([
  "account-not-registered",
  "account-in-savings-ring",
]);

export const ImportStatusLine = async ({
  status,
}: {
  readonly status: string | undefined;
}) => {
  if (status === undefined || !isKnownImportStatus(status)) {
    return null;
  }
  const t = await getTranslations();
  const key = IMPORT_STATUS_KEYS[status];
  return (
    <p className="import-status" data-testid="import-status">
      {SETUP_LINKED.has(status)
        ? t.rich(key, {
            setup: (chunks) => (
              <Link href="/accounts">
                {chunks}
                <LinkPending />
              </Link>
            ),
          })
        : t(key)}
    </p>
  );
};
