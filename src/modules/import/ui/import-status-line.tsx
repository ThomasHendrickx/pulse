import { getTranslations } from "next-intl/server";
import { IMPORT_STATUS_KEYS, isKnownImportStatus } from "./status-keys";

// Localized status line for the import screens, driven by whitelisted
// ?status= values. Unknown values render nothing.

export const ImportStatusLine = async ({
  status,
}: {
  readonly status: string | undefined;
}) => {
  if (status === undefined || !isKnownImportStatus(status)) {
    return null;
  }
  const t = await getTranslations();
  return (
    <p className="import-status" data-testid="import-status">
      {t(IMPORT_STATUS_KEYS[status])}
    </p>
  );
};
