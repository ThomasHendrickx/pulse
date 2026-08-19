"use server";

// The recompute action: the interpretation step with no import attached,
// over everything (pulse-v1-architecture.md: one internal action, dev-only
// surface). A server action does one thing: resolve the household context,
// call one use case, revalidate (pulse-frontend section 1). The dev-only
// screen that carries its button arrives with the month view (M1-P5);
// until then the action is the module's published dev surface.

import { revalidatePath } from "next/cache";
import { requireHouseholdContext } from "@/platform/auth/context";
import { isProduction } from "@/platform/config";
import { recomputeInterpretation } from "../application";

export const recomputeAction = async (): Promise<void> => {
  if (isProduction()) {
    // Dev-only by contract: recompute in production is a deliberate
    // operator decision, not a button. Unexpected here, so an exception,
    // not a Result (pulse-typescript section 5).
    throw new Error("Recompute is a dev-only action");
  }
  const context = await requireHouseholdContext();
  await recomputeInterpretation(context);
  revalidatePath("/");
};
