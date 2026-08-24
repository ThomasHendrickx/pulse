"use server";

// Server actions for the accounts screen: resolve the household context
// once, call ONE use case, revalidate (pulse-frontend section 1).
//
// THE ENGINE DEPENDENCIES ARE BOUND HERE and not in the accounts module's
// composition root, deliberately and for the same reason the merchants
// module binds its recompute in its own UI action: the ledger's composition
// root imports the accounts module for its declared-set read, so importing
// the ledger back from there would be a module cycle. Both arguments are
// the ledger's PUBLISHED interface.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import {
  previewDeclarationChange,
  recomputeInterpretation,
} from "@/modules/ledger/application";
import { parseAccountRole } from "../application";
import { correctAccountRing, registerAccount } from "../application";

const engine = {
  preview: previewDeclarationChange,
  recompute: recomputeInterpretation,
};

const back = (status: string, extra?: Record<string, string>): string => {
  const params = new URLSearchParams({ status, ...(extra ?? {}) });
  return `/accounts?${params.toString()}`;
};

export const registerAccountAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const role = parseAccountRole(String(formData.get("ring") ?? ""));
  if (!role.ok) {
    redirect(back("ring-needed"));
  }
  const outcome = await registerAccount(
    context,
    {
      label: String(formData.get("label") ?? ""),
      bank: String(formData.get("bank") ?? ""),
      role: role.value,
      accountNumber: String(formData.get("accountNumber") ?? ""),
    },
    engine,
  );
  if (!outcome.ok) {
    const error = outcome.error;
    if (error.kind === "invalid-account-number") {
      redirect(
        back(error.reason.kind, {
          ...("country" in error.reason ? { country: error.reason.country } : {}),
          ...("expected" in error.reason
            ? {
                expected: String(error.reason.expected),
                actual: String(error.reason.actual),
              }
            : {}),
        }),
      );
    }
    if (error.kind === "already-registered") {
      redirect(back(error.kind, { label: error.existing.label }));
    }
    redirect(back(error.kind));
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/merchants");
  redirect(
    back("registered", {
      label: outcome.value.account.label,
      rules: String(outcome.value.merchantRulesStoppedMatching),
    }),
  );
};

export const correctAccountRingAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const role = parseAccountRole(String(formData.get("ring") ?? ""));
  if (!role.ok) {
    redirect(back("ring-needed"));
  }
  const outcome = await correctAccountRing(
    context,
    {
      accountId: String(formData.get("accountId") ?? ""),
      role: role.value,
    },
    engine,
  );
  if (!outcome.ok) {
    redirect(back(outcome.error.kind));
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/merchants");
  redirect(
    back("ring-corrected", {
      label: outcome.value.account.label,
      rules: String(outcome.value.moved.merchantRulesStoppedMatching),
    }),
  );
};
