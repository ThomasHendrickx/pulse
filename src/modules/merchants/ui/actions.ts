"use server";

// The manual-assignment action: resolve the household context, call ONE
// use case, revalidate (pulse-frontend section 1). The use case writes the
// MerchantRule declaration and runs recompute itself; the action's only
// composition job is binding that recompute dependency to the ledger
// module's published interface. Binding it HERE rather than in the
// merchants composition root is deliberate: the ledger's own composition
// root imports the merchants module for its resolver binding, so the
// reverse import would be a module cycle (see the merchants
// application/index.ts header).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import { recomputeInterpretation } from "@/modules/ledger/application";
import { assignMerchant } from "../application";

export const assignMerchantAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const outcome = await assignMerchant(
    context,
    {
      counterpartyText: String(formData.get("counterpartyText") ?? ""),
      merchantName: String(formData.get("merchantName") ?? ""),
    },
    recomputeInterpretation,
  );
  if (!outcome.ok) {
    redirect("/merchants?status=name-missing");
  }
  revalidatePath("/merchants");
  redirect("/merchants");
};
