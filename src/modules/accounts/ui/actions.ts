"use server";

// Server actions for the accounts screen. Each resolves the household
// context once, calls ONE use case, and either returns the use case's typed
// failure for the screen to render or revalidates and redirects
// (pulse-frontend section 1). No business logic here.
//
// WHERE THE LEDGER EDGE IS BOUND, and why here. The accounts use cases need
// two things from the ledger: the published recompute, and whether an
// account carries imported rows of its own. The ledger's own composition
// root already imports the accounts module's published interface
// (src/modules/ledger/application/index.ts), so binding the reverse edge in
// the accounts composition root would make two module indexes import each
// other at evaluation time. This is the same shape, and the same reason, as
// src/modules/merchants/ui/actions.ts, which binds recompute here for
// exactly this reason.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import {
  hasImportedRows,
  recomputeInterpretation,
} from "@/modules/ledger/application";
import {
  changeAccountRing,
  parseAccountRole,
  registerAccounts,
  type AccountRegistrationInput,
  type AccountsLedgerGateway,
  type RegisterAccountsFailure,
} from "../application";

const ledger: AccountsLedgerGateway = {
  recompute: async (context) => {
    await recomputeInterpretation(context);
  },
  hasImportedRows,
};

// What the setup form renders after a refused submission. Serializable by
// construction: it crosses the server-action boundary back into the client
// island, which keeps the rows the owner typed in its own state, so a
// refusal never clears the other seven rows (criterion 14.3).
export type RegisterAccountsState =
  | { readonly status: "idle" }
  | { readonly status: "refused"; readonly failure: RegisterAccountsFailure };

// The rows arrive as four PARALLEL repeated fields rather than an encoded
// blob, so the form is an ordinary HTML form and the row index is document
// order. getAll returns one entry per rendered row for every field,
// including an unanswered ring, which is what lets "the ring was not
// answered" be reported against its own row instead of shifting the others.
const rowsFrom = (formData: FormData): readonly AccountRegistrationInput[] => {
  const labels = formData.getAll("label");
  const banks = formData.getAll("bank");
  const numbers = formData.getAll("accountNumber");
  const rings = formData.getAll("ring");
  return labels.map((_, index) => ({
    label: String(labels[index] ?? ""),
    bank: String(banks[index] ?? ""),
    accountNumber: String(numbers[index] ?? ""),
    ring: String(rings[index] ?? ""),
  }));
};

export const registerAccountsAction = async (
  _previous: RegisterAccountsState,
  formData: FormData,
): Promise<RegisterAccountsState> => {
  const context = await requireHouseholdContext();
  const outcome = await registerAccounts(context, ledger, {
    rows: rowsFrom(formData),
  });
  if (!outcome.ok) {
    return { status: "refused", failure: outcome.error };
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect("/accounts?status=registered");
};

export const changeAccountRingAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const accountId = String(formData.get("accountId") ?? "");
  const role = parseAccountRole(String(formData.get("ring") ?? ""));
  if (!role.ok) {
    redirect("/accounts?status=ring-invalid");
  }
  const outcome = await changeAccountRing(context, ledger, {
    accountId,
    role: role.value,
  });
  if (!outcome.ok) {
    // THE REFUSAL IS SHOWN, never swallowed. Each kind gets its own
    // selector so the reader is told which thing was wrong, and the
    // has-own-rows message says what v1 cannot do rather than failing
    // silently (decision D-51).
    const status =
      outcome.error.kind === "account-has-own-rows"
        ? "ring-has-rows"
        : outcome.error.kind === "ring-unchanged"
          ? "ring-unchanged"
          : "ring-account-unknown";
    redirect(`/accounts?status=${status}`);
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect("/accounts?status=ring-changed");
};
