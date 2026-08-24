// Whitelisted ?status= values for the accounts screen, mapped to message
// keys. Same discipline as the import and auth screens: the query parameter
// is a SELECTOR, never content, and membership is an OWN-property test,
// never the `in` operator (finding CR-006).
//
// EVERY REFUSAL THE SERVER ACTION CAN NAME IS ON THIS MAP. A reason the
// action redirects with and this map does not carry is a blank screen with a
// query parameter on it, which is why a test asserts the two agree rather
// than leaving it to convention.

export const ACCOUNT_STATUS_KEYS = {
  "empty-label": "accountsErrorLabel",
  "empty-bank": "accountsErrorBank",
  "account-number-required": "accountsErrorNumberRequired",
  "account-number-empty": "accountsErrorNumberEmpty",
  "account-number-unknown-country": "accountsErrorNumberCountry",
  "account-number-wrong-length": "accountsErrorNumberLength",
  "account-number-check-failed": "accountsErrorNumberCheck",
  "already-registered": "accountsErrorAlreadyRegistered",
  "account-not-found": "accountsErrorNotFound",
  "reserve-ring-needs-account-number": "accountsErrorReserveNeedsNumber",
  "ring-needed": "importRingNeeded",
  registered: "accountsRegistered",
  "ring-corrected": "accountsRegistered",
} as const;

export type KnownAccountStatus = keyof typeof ACCOUNT_STATUS_KEYS;

export const isKnownAccountStatus = (
  value: string,
): value is KnownAccountStatus => Object.hasOwn(ACCOUNT_STATUS_KEYS, value);
