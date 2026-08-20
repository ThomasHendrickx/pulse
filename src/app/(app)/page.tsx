import { requireHouseholdContext } from "@/platform/auth/context";
import { MonthScreen } from "@/modules/overview/ui";

// The month view, the default route. Thin by rule (pulse-frontend section
// 2): resolve the household context once at the boundary, read the month
// search parameter, hand off to the overview module's UI. The empty state
// before the first import is the overview module's to render.

export default async function MonthPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly month?: string }>;
}) {
  const context = await requireHouseholdContext();
  const { month } = await searchParams;
  return (
    <MonthScreen
      context={context}
      {...(month === undefined ? {} : { requestedMonth: month })}
    />
  );
}
