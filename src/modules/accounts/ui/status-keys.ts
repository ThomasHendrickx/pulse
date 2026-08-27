// Whitelisted ?status= values for the accounts screen, mapped to message
// keys. Same discipline as the import and auth screens: the query
// parameter is a SELECTOR, never content, and membership is an
// OWN-property test, never the `in` operator (finding CR-006).

export const ACCOUNTS_STATUS_KEYS = {
  registered: "accountsRegistered",
  "ring-changed": "accountsRingChanged",
  // The one ring refusal v1 has: the account already carries its own
  // imported rows, so its ring is fixed (decision D-51).
  "ring-has-rows": "accountsRingHasRows",
  "ring-unchanged": "accountsRingUnchanged",
  "ring-account-unknown": "accountsRingAccountUnknown",
  "ring-invalid": "accountsRingInvalid",
} as const;

export type KnownAccountsStatus = keyof typeof ACCOUNTS_STATUS_KEYS;

export const isKnownAccountsStatus = (
  value: string,
): value is KnownAccountsStatus =>
  Object.hasOwn(ACCOUNTS_STATUS_KEYS, value);
