// Whitelisted ?status= values for the import screens, mapped to message
// keys. Same discipline as the auth screens: the query parameter is a
// selector, never content, and membership is an OWN-property test, never
// the `in` operator (finding CR-006).

export const IMPORT_STATUS_KEYS = {
  "no-file": "importNoFile",
  "bad-spec": "importBadSpec",
  "declaration-needed": "importDeclarationNeeded",
} as const;

export type KnownImportStatus = keyof typeof IMPORT_STATUS_KEYS;

export const isKnownImportStatus = (
  value: string,
): value is KnownImportStatus => Object.hasOwn(IMPORT_STATUS_KEYS, value);
