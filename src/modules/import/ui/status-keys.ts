// Whitelisted ?status= values for the import screens, mapped to message
// keys. Same discipline as the auth screens: the query parameter is a
// selector, never content, and membership is an OWN-property test, never
// the `in` operator (finding CR-006).

export const IMPORT_STATUS_KEYS = {
  "no-file": "importNoFile",
  "bad-spec": "importBadSpec",
  "declaration-needed": "importDeclarationNeeded",
  // The two refusals M3-P14 adds (criterion 14.11 witness TWO). A rejection
  // reason reaches the screen ONLY through this whitelist and the routing in
  // actions.ts, so a reason the server names and this map does not carry
  // renders a blank screen with a query parameter on it.
  "ring-needed": "importRingNeeded",
  "reserve-needs-account-number": "importReserveNeedsAccountNumber",
} as const;

export type KnownImportStatus = keyof typeof IMPORT_STATUS_KEYS;

export const isKnownImportStatus = (
  value: string,
): value is KnownImportStatus => Object.hasOwn(IMPORT_STATUS_KEYS, value);
