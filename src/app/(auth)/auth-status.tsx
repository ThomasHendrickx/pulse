import { getTranslations } from "next-intl/server";

// Localized auth status line, driven by the whitelisted ?status= values the
// auth server actions redirect with. An unknown value renders nothing, so
// the query parameter is a selector and never content (fix round 1, finding
// CR-004).

const STATUS_KEYS = {
  "signin-failed": "signinFailed",
  "signup-failed": "signupIncomplete",
  "incomplete-signup": "signupIncomplete",
  "confirm-email": "confirmEmail",
} as const;

type KnownStatus = keyof typeof STATUS_KEYS;

const isKnownStatus = (value: string): value is KnownStatus =>
  value in STATUS_KEYS;

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
