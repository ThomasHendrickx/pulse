// Whitelisted ?status= values for the import screens, mapped to message
// keys. Same discipline as the auth screens: the query parameter is a
// selector, never content, and membership is an OWN-property test, never
// the `in` operator (finding CR-006).

export const IMPORT_STATUS_KEYS = {
  "no-file": "importNoFile",
  "bad-spec": "importBadSpec",
  "declaration-needed": "importDeclarationNeeded",
  // M3-P14: the file's own account is not one the household registered at
  // setup. The account-in-savings-ring selector that stood beside this
  // one is removed with its refusal (M3-P18, DR-0030): a savings
  // account's own statement is accepted and its rows are shown held.
  "account-not-registered": "importAccountNotRegistered",
} as const;

export type KnownImportStatus = keyof typeof IMPORT_STATUS_KEYS;

export const isKnownImportStatus = (
  value: string,
): value is KnownImportStatus => Object.hasOwn(IMPORT_STATUS_KEYS, value);
