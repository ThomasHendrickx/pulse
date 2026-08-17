import { getTranslations } from "next-intl/server";

// The month view route. Before the first import there is no month to show,
// so the skeleton renders the empty state; the real view lands with slice 4.

export default async function MonthPage() {
  const t = await getTranslations();

  return (
    <section className="empty-state" data-testid="empty-state">
      <h1>{t("noData")}</h1>
      <p>{t("emptyTitle")}</p>
      <p>{t("emptyBody")}</p>
    </section>
  );
}
