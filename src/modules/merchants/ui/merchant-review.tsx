import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import type { HouseholdContext } from "@/platform/tenancy";
import { listMerchantReview } from "../application";
import type { ReviewGroup } from "../application";
import { assignMerchantAction } from "./actions";

// The merchant review screen: counted transactions grouped per direction,
// resolved groups under their merchant name, unresolved ones under the
// normalised counterparty text with a one-click naming form. Unresolved is
// NORMAL, not an error (pulse-frontend section 5): flag treatment, with
// the copy saying plainly that these rows are already counted in every
// total and naming only moves them into the right group. The direction
// totals render beside each section precisely so that naming can be SEEN
// to leave them unchanged (hazard H3.2).

const GroupRow = async ({
  group,
}: {
  readonly group: ReviewGroup;
}) => {
  const t = await getTranslations();
  const unresolved = group.merchantId === undefined;
  return (
    <li
      className={unresolved ? "merchant-row merchant-row-unresolved" : "merchant-row"}
      data-testid={unresolved ? "unresolved-group" : "merchant-group"}
    >
      {/* The label of an unresolved group is the normalised descriptor for a
          descriptor-basis group, so a card descriptor rendered the card
          number here. Masked in the RENDERING only (M3-P6, decision D-12):
          the hidden counterpartyText field below stays UNMASKED, because
          that value is the counterparty IDENTITY KEY that becomes the EXACT
          MerchantRule pattern, and a masked subject would match nothing. */}
      <span className="merchant-row-label" data-testid="group-label">
        {maskCardNumbers(group.label)}
      </span>
      <span className="merchant-row-count">
        {group.count} {t("rows")}
      </span>
      <span data-testid="group-total">
        <Amount cents={group.totalCents} />
      </span>
      {unresolved && group.counterpartyText !== undefined ? (
        <form action={assignMerchantAction} className="merchant-name-form">
          <input
            type="hidden"
            name="counterpartyText"
            value={group.counterpartyText}
          />
          <label className="merchant-name-field">
            <span className="visually-hidden">{t("namePlaceholder")}</span>
            <input
              type="text"
              name="merchantName"
              placeholder={t("namePlaceholder")}
              required
            />
          </label>
          <button type="submit" className="merchant-name-button">
            {t("nameIt")}
          </button>
        </form>
      ) : null}
    </li>
  );
};

const DirectionSection = async ({
  titleKey,
  totalTestId,
  groups,
  totalCents,
}: {
  readonly titleKey: "income" | "spend";
  readonly totalTestId: string;
  readonly groups: readonly ReviewGroup[];
  readonly totalCents: number;
}) => {
  const t = await getTranslations();
  return (
    <section className="merchant-section">
      <header className="merchant-section-header">
        <h2>{t(titleKey)}</h2>
        <span className="merchant-section-total">
          {t("total")}{" "}
          <span data-testid={totalTestId}>
            <Amount cents={totalCents} />
          </span>
        </span>
      </header>
      <ul className="merchant-list">
        {groups.map((group) => (
          <GroupRow key={group.key} group={group} />
        ))}
      </ul>
    </section>
  );
};

// The refusal statuses the assignment action redirects with, mapped to the
// message that tells the reader what happened (criterion 12.18). A status
// this map does not carry renders nothing, so an unknown query string can
// never put an empty banner on the screen.
const REFUSAL_MESSAGE: Readonly<Record<string, "nameRefusedStale" | "nameRefusedName" | "nameRefusedAccount">> =
  {
    "empty-merchant-name": "nameRefusedName",
    "empty-counterparty": "nameRefusedStale",
    "unnamespaced-counterparty": "nameRefusedStale",
    "untrusted-counterparty-account": "nameRefusedAccount",
  };

export const MerchantReviewScreen = async ({
  context,
  status,
}: {
  readonly context: HouseholdContext;
  readonly status?: string;
}) => {
  const [t, review] = await Promise.all([
    getTranslations(),
    listMerchantReview(context),
  ]);
  const refusal = status === undefined ? undefined : REFUSAL_MESSAGE[status];
  return (
    <section className="merchant-screen">
      <h1>{t("merchants")}</h1>
      <p className="merchant-lead">{t("merchantsBody")}</p>
      {refusal === undefined ? null : (
        <p className="merchant-refused" data-testid="naming-refused" role="status">
          {t(refusal)}
        </p>
      )}
      <p className="merchant-note" data-testid="unresolved-count">
        {review.unresolvedCount}{" "}
        {review.unresolvedCount === 1 ? t("unresolvedOne") : t("unresolvedMany")}
      </p>
      <DirectionSection
        titleKey="income"
        totalTestId="income-total"
        groups={review.income}
        totalCents={review.incomeTotalCents}
      />
      <DirectionSection
        titleKey="spend"
        totalTestId="spend-total"
        groups={review.spend}
        totalCents={review.spendTotalCents}
      />
      <p className="merchant-note">{t("merchantsFoot")}</p>
    </section>
  );
};
