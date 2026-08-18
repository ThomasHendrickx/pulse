// The whitelisted ?status= values the auth server actions redirect with,
// mapped to message-catalog keys. Extracted from auth-status.tsx so the
// membership check is unit-testable (M1-P1 hazard review, finding CR-006).
//
// Membership MUST be an own-property test. The `in` operator walks the
// prototype chain, so `"constructor" in STATUS_KEYS` is true and a crafted
// /sign-in?status=constructor link would drive the translator with a
// Function value instead of a message key. Object.hasOwn tests own keys
// only. test/app/auth-status.test.ts carries the red witness for both a
// prototype key and an honest unknown value.

export const STATUS_KEYS = {
  "signin-failed": "signinFailed",
  "signup-failed": "signupIncomplete",
  "incomplete-signup": "signupIncomplete",
  "confirm-email": "confirmEmail",
} as const;

export type KnownStatus = keyof typeof STATUS_KEYS;

export const isKnownStatus = (value: string): value is KnownStatus =>
  Object.hasOwn(STATUS_KEYS, value);
