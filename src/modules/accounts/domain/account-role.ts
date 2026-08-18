// The ring an account sits in (pulse-domain section 1): POT is where
// income lands and spend happens, RESERVE is parked money. The user
// declares it at first sight; it is never inferred, never guessed from a
// name, never defaulted.

import { err, ok, type Result } from "@/platform/result";

export type AccountRole = "POT" | "RESERVE";

export type AccountRoleParseError = {
  readonly kind: "invalid-account-role";
  readonly value: string;
};

export const parseAccountRole = (
  value: string,
): Result<AccountRole, AccountRoleParseError> =>
  value === "POT" || value === "RESERVE"
    ? ok(value)
    : err({ kind: "invalid-account-role" as const, value });
