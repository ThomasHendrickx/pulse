import { requireHouseholdContext } from "@/platform/auth/context";
import { MerchantReviewScreen } from "@/modules/merchants/ui";

// Thin route (pulse-frontend section 2): resolve the context once at the
// boundary, hand off to the merchants module's UI.

export default async function MerchantsPage() {
  const context = await requireHouseholdContext();
  return <MerchantReviewScreen context={context} />;
}
