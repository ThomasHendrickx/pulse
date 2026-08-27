import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import type { HouseholdContext } from "@/platform/tenancy";
import { listMerchantReview } from "../application";
import type { ReviewGroup } from "../application";
import { assignMerchantAction } from "./actions";
import { MerchantGroupRow } from "./merchant-row";
import type { NamingCopy } from "./merchant-row";

// The merchant review screen: counted transactions grouped per direction,
// resolved groups under their merchant name, unresolved ones under the
// normalised counterparty text with a one-click naming form. Unresolved is
// NORMAL, not an error (pulse-frontend section 5): flag treatment, with
// the copy saying plainly that these rows are already counted in every
// total and naming only moves them into the right group. The direction
// totals render beside each section precisely so that naming can be SEEN
// to leave them unchanged (hazard H3.2).
//
// Since M3-P11 every nameable row renders through the MerchantGroupRow
// client leaf, which predicts the label per DR-0025 and raises the DR-0026
// notices. This component stays a server component and resolves every
// string the leaf renders, so no message catalogue crosses the boundary.

const GroupRow = async ({
  group,
  direction,
}: {
  readonly group: ReviewGroup;
  // Which section renders this row. It reaches the client leaf because the
  // claim that raises the difference notice must agree on it (fix round,
  // finding HZ-M3P11-02): one merchant with groups on both sides renders
  // two rows carrying the same label.
  readonly direction: "income" | "spend";
}) => {
  const t = await getTranslations();
  const unresolved = group.merchantId === undefined;
  // A GROUP THAT CANNOT BE NAMED STILL NEEDS A NAME ON THE SCREEN (fix
  // round two, findings CR2-M3P12-07 and HZ-M3P12-R2-04). It stays fully
  // server rendered: nothing about it can be predicted because nothing
  // about it can be submitted, so it pays for no client boundary. It still
  // carries the stable data-group-key identity every row shares
  // (criterion 11.3), masked like the label beside it.
  if (unresolved && group.unnameableReason !== undefined) {
    return (
      <li
        className="merchant-row merchant-row-unresolved"
        data-testid="unresolved-group"
        data-group-key={maskCardNumbers(group.key)}
      >
        <span className="merchant-row-label" data-testid="group-label">
          {t("unnameableLabel")}
        </span>
        <span className="merchant-row-count">
          {group.count} {t("rows")}
        </span>
        <span data-testid="group-total">
          <Amount cents={group.totalCents} />
        </span>
        {/* THE REASON WHERE THE FORM WOULD HAVE BEEN. The copy already
            existed and was reachable only by submitting a form the screen
            no longer offers, so the explanation could never be read. */}
        <p className="merchant-row-unnameable" data-testid="group-unnameable">
          {t("nameRefusedUnidentifiable")}
        </p>
      </li>
    );
  }
  // Every string the client leaf can ever render, resolved HERE. The
  // refusal kinds that keep M3-P12's specific wording are listed by kind;
  // empty-merchant-name is deliberately NOT among them: the whitespace-only
  // name is criterion 11.4's forced domain failure and carries the one
  // failure message, and the transport failure shares it.
  const copy: NamingCopy = {
    unconfirmed: t("nameUnconfirmed"),
    // THE FAILURE SENTENCE CLAIMS ONLY WHAT THE CLIENT KNOWS (fix round,
    // finding HZ-M3P11-04). It used to say the name was not saved, and
    // that is a claim about the server which the client cannot make: the
    // use case writes the MerchantRule and only THEN awaits recompute
    // (src/modules/merchants/application/assign-merchant.ts, upsertRule
    // before await deps.recompute), so an exception in recompute or a
    // connection lost on the response leg leaves the declaration stored
    // while this notice is on screen. The wording now says the answer did
    // not arrive, describes the SCREEN rather than storage, and tells the
    // reader how to find out. It stays true on the other arm too, where
    // the server did answer and wrote nothing.
    failed: t("namingFailed"),
    differs: t("namingDiffers"),
    dismiss: t("noticeDismiss"),
    refusals: {
      "empty-counterparty": t("nameRefusedStale"),
      "unnamespaced-counterparty": t("nameRefusedStale"),
      "non-canonical-counterparty": t("nameRefusedStale"),
      "untrusted-counterparty-account": t("nameRefusedAccount"),
      "unidentifiable-counterparty": t("nameRefusedUnidentifiable"),
    },
  };
  return (
    <MerchantGroupRow
      // The row's stable DOM identity, MASKED (criterion 11.3, finding
      // DELTA-M0P4-08): for an unresolved group the raw key IS the
      // normalised descriptor, and criterion 11.3 only ever compares the
      // sequence to itself.
      groupKey={maskCardNumbers(group.key)}
      // The label of an unresolved group is the normalised descriptor for
      // a descriptor-basis group, so a card descriptor rendered the card
      // number here. Masked in the RENDERING only (M3-P6, decision D-12):
      // the hidden counterpartyText field inside the leaf stays UNMASKED,
      // because that value is the counterparty IDENTITY KEY that becomes
      // the EXACT MerchantRule pattern, and a masked subject would match
      // nothing.
      label={maskCardNumbers(group.label)}
      countText={`${group.count} ${t("rows")}`}
      totalCents={group.totalCents}
      unresolved={unresolved}
      direction={direction}
      copy={copy}
      {...(unresolved && group.counterpartyText !== undefined
        ? {
            naming: {
              identityKey: group.counterpartyText,
              fieldLabel: t("namePlaceholder"),
              placeholder: t("namePlaceholder"),
              submitLabel: t("nameIt"),
            },
            action: assignMerchantAction,
          }
        : {})}
    />
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
          <GroupRow key={group.key} group={group} direction={titleKey} />
        ))}
      </ul>
    </section>
  );
};

// The refusal statuses mapped to the message that tells the reader what
// happened (criterion 12.18). CORRECTED IN M3-P11 (clause R-087): this
// comment used to say the assignment action redirects with these statuses,
// and since M3-P11 it does not. The action returns its refusal to the
// client leaf, which raises the notice on the row (DR-0026), so nothing
// sets /merchants?status= any more. The banner path is kept because the
// route still reads the parameter and a rendered sentence for a hand-typed
// or bookmarked status URL is better than a silently ignored one; a status
// this map does not carry renders nothing, so an unknown query string can
// never put an empty banner on the screen.
const REFUSAL_MESSAGE: Readonly<
  Record<
    string,
    | "nameRefusedStale"
    | "nameRefusedName"
    | "nameRefusedAccount"
    | "nameRefusedUnidentifiable"
  >
> = {
  "empty-merchant-name": "nameRefusedName",
  "empty-counterparty": "nameRefusedStale",
  "unnamespaced-counterparty": "nameRefusedStale",
  "untrusted-counterparty-account": "nameRefusedAccount",
  "unidentifiable-counterparty": "nameRefusedUnidentifiable",
  // A subject that is not the key the screen renders did not come from a
  // rendered group, which is the same thing a page left open across the
  // deploy submits, so the reader gets the same instruction: reload and name
  // the group again (fix round two, finding CR2-M3P12-08).
  "non-canonical-counterparty": "nameRefusedStale",
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
