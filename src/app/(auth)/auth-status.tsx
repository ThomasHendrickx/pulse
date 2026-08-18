import { getTranslations } from "next-intl/server";
import { STATUS_KEYS, isKnownStatus } from "./status-keys";

// Localized auth status line, driven by the whitelisted ?status= values the
// auth server actions redirect with. An unknown value renders nothing, so
// the query parameter is a selector and never content (fix round 1, finding
// CR-004). The whitelist lives in status-keys.ts and is an own-property
// check, never the `in` operator, because `in` walks the prototype chain
// and admits inherited keys like "constructor" (finding CR-006).

export const AuthStatus = async ({
  status,
}: {
  readonly status: string | undefined;
}) => {
  if (status === undefined || !isKnownStatus(status)) {
    return null;
  }
  const t = await getTranslations();
  return (
    <p className="auth-status" data-testid="auth-status">
      {t(STATUS_KEYS[status])}
    </p>
  );
};
