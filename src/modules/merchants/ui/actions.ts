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
import type { AssignMerchantError } from "../application";

// THE FAILURE IS REPORTED, NOT REDIRECTED (M3-P11, DR-0025 and DR-0026).
// Until this phase a refused naming redirected to /merchants?status=<kind>
// and the screen rendered the mapped refusal banner (M3-P12, criterion
// 12.18). That mechanism swapped the whole document to say one sentence,
// and it could not tell the predicting row that its prediction failed. The
// action now RETURNS the refusal as a value the awaiting client wrapper
// reads, and the wrapper reverts the prediction and raises the notice
// (decision D-32). The success path is untouched: revalidate, then
// redirect, exactly as before.
//
// The honest limit, recorded rather than hidden: without JavaScript the
// form still posts, the returned value reaches nothing, and the failure is
// silent, as the pre-M3-P12 screen was. The screen still reads
// /merchants?status=<kind> (merchant-review.tsx REFUSAL_MESSAGE), so the
// banner path remains renderable, but nothing sets that status any more.
export type AssignMerchantActionResult =
  // UNREACHABLE TODAY, AND KEPT DELIBERATELY (fix round, finding
  // HZ-M3P11-06): the success path ends in redirect(), which throws, so
  // this action never returns an ok value. The arm exists so the client
  // leaf's structural type has a success shape to match, and so a later
  // change that stops redirecting has somewhere to land. The client checks
  // the shape it receives rather than trusting either assumption.
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: { readonly kind: AssignMerchantError["kind"] };
    };

export const assignMerchantAction = async (
  formData: FormData,
): Promise<AssignMerchantActionResult> => {
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
    // THE REFUSAL IS SHOWN, never swallowed (criterion 12.18's intent,
    // carried by the toast since M3-P11). Only the KIND crosses the
    // boundary: the UI owns the wording, in three languages, so an error
    // carrying an English sentence cannot exist here (pulse-typescript
    // section 5).
    return { ok: false, error: { kind: outcome.error.kind } };
  }
  revalidatePath("/merchants");
  redirect("/merchants");
};
