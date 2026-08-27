import { requireHouseholdContext } from "@/platform/auth/context";
import { MerchantReviewScreen } from "@/modules/merchants/ui";

// Thin route (pulse-frontend section 2): resolve the context once at the
// boundary, hand off to the merchants module's UI.

export default async function MerchantsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireHouseholdContext();
  // The assignment action redirects here with a status when it REFUSED a
  // naming; the screen shows it rather than swallowing it (criterion 12.18).
  const params = searchParams === undefined ? {} : await searchParams;
  const raw = params["status"];
  const status = Array.isArray(raw) ? raw[0] : raw;
  return (
    <MerchantReviewScreen
      context={context}
      {...(status === undefined ? {} : { status })}
    />
  );
}
