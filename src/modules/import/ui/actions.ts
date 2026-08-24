"use server";

// Server actions for the import flow. Each resolves the household context
// once, calls ONE use case, and redirects; no business logic here
// (pulse-frontend section 1).

import { redirect } from "next/navigation";
import { requireHouseholdContext } from "@/platform/auth/context";
import { parseAccountRole } from "@/modules/accounts/application";
import type { AccountRole } from "@/modules/accounts/application";
import {
  confirmImport,
  parseSourceProfileSpec,
  uploadStatement,
} from "../application";

export const uploadStatementAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?status=no-file");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const outcome = await uploadStatement(context, {
    fileName: file.name,
    bytes,
  });
  redirect(`/import/${outcome.importId}`);
};

const specFrom = (formData: FormData): ReturnType<typeof parseSourceProfileSpec> => {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("spec") ?? ""));
  } catch {
    return { ok: false, error: { kind: "invalid-spec", at: "json" } };
  }
  return parseSourceProfileSpec(raw);
};

// The "preview again" half of confirm-or-fix: carry the edited format
// description back to the confirmation page so the five rows re-render
// from it. The spec travels as a validated query parameter; an invalid
// edit bounces back with the bad-spec status instead of a broken preview.
export const previewImportAction = async (
  formData: FormData,
): Promise<void> => {
  await requireHouseholdContext();
  const importId = encodeURIComponent(String(formData.get("importId") ?? ""));
  const spec = specFrom(formData);
  if (!spec.ok) {
    redirect(`/import/${importId}?status=bad-spec`);
  }
  redirect(
    `/import/${importId}?spec=${encodeURIComponent(JSON.stringify(spec.value))}`,
  );
};

export const confirmImportAction = async (
  formData: FormData,
): Promise<void> => {
  const context = await requireHouseholdContext();
  const importId = String(formData.get("importId") ?? "");
  const safeId = encodeURIComponent(importId);
  const spec = specFrom(formData);
  if (!spec.ok) {
    redirect(`/import/${safeId}?status=bad-spec`);
  }

  const profileName = String(formData.get("profileName") ?? "").trim();
  if (profileName === "") {
    redirect(`/import/${safeId}?status=declaration-needed`);
  }

  // THE RING IS CARRIED THROUGH UNANSWERED RATHER THAN FILLED IN HERE
  // (criterion 14.11 witness TWO). This boundary used to drop the whole
  // declaration when the ring was missing, which reported the generic
  // "declaration needed" and told the household nothing about which answer
  // was missing. It must never supply one: the answer decides whether the
  // statement's rows are counted or held.
  let declaration:
    | { readonly label: string; readonly bank: string; readonly role?: AccountRole }
    | undefined;
  const label = String(formData.get("accountLabel") ?? "").trim();
  const bank = String(formData.get("accountBank") ?? "").trim();
  const role = parseAccountRole(String(formData.get("accountRole") ?? ""));
  if (label !== "" && bank !== "") {
    declaration = { label, bank, ...(role.ok ? { role: role.value } : {}) };
  }

  const outcome = await confirmImport(context, {
    importId,
    profileName,
    spec: spec.value,
    ...(declaration === undefined ? {} : { declaration }),
  });
  if (outcome.kind === "rejected") {
    if (
      outcome.reason === "already-confirmed" ||
      outcome.reason === "not-awaiting-declaration"
    ) {
      // Settled by another confirm (finding F4): the detail page renders
      // the settled result; nothing to re-ask.
      redirect(`/import/${safeId}`);
    }
    // EVERY NAMED REFUSAL REACHES THE SCREEN THROUGH THE WHITELIST
    // (criterion 14.11 witness TWO). A reason the server names and the
    // whitelist does not carry is a blank screen with a query parameter on
    // it, which is why status-keys.ts and this routing are asserted
    // together by a test rather than kept in step by convention.
    redirect(
      outcome.reason === "declaration-needed" ||
        outcome.reason === "ring-needed" ||
        outcome.reason === "reserve-needs-account-number"
        ? `/import/${safeId}?status=${outcome.reason}`
        : `/import/${safeId}?status=bad-spec`,
    );
  }
  redirect(`/import/${safeId}`);
};
