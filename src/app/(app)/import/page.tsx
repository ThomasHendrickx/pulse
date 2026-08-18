import { requireHouseholdContext } from "@/platform/auth/context";
import { UploadForm } from "@/modules/import/ui";

// Thin route (pulse-frontend section 2): resolve the context, hand off to
// the import module's UI.

export default async function ImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  await requireHouseholdContext();
  const { status } = await searchParams;
  return <UploadForm status={status} />;
}
