// Whitelisted ?status= values for the import screens, mapped to message
// keys. Same discipline as the auth screens: the query parameter is a
// selector, never content, and membership is an OWN-property test, never
// the `in` operator (finding CR-006).

export const IMPORT_STATUS_KEYS = {
  "no-file": "importNoFile",
  "bad-spec": "importBadSpec",
  "declaration-needed": "importDeclarationNeeded",
  // M3-P14: the file's own account is not one the household registered at
  // setup, and the file's own account is registered in the savings ring
  // whose statements are not imported in v1 (decision D-55). Two selectors
  // because the two messages differ: the second names the ring correction
  // AND what that correction costs.
  "account-not-registered": "importAccountNotRegistered",
  "account-in-savings-ring": "importAccountInSavingsRing",
} as const;

export type KnownImportStatus = keyof typeof IMPORT_STATUS_KEYS;

export const isKnownImportStatus = (
  value: string,
): value is KnownImportStatus => Object.hasOwn(IMPORT_STATUS_KEYS, value);
