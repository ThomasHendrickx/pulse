import { createHash } from "node:crypto";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Amount } from "@/platform/ui/amount";
import { maskAccountNumbers } from "@/platform/ui/mask-account-number";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import type { HouseholdContext } from "@/platform/tenancy";
import { listMerchantReview } from "../application";
import type { ReviewGroup, ReviewGroupRow } from "../application";
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

// WHAT THE SCREEN SAYS ABOUT A GROUP (M3-P13). Three small server-rendered
// pieces, each answering one half of the owner's question quoted in decision
// D-36: what joined these transactions, how far a naming will reach, and
// which transactions are actually in here.
//
// THE BASIS IS COPY, NEVER A CODE (hazard H13.4): the two strings live in
// the three catalogues and are resolved here, so a Dutch or French reader
// meets their own language rather than an English word or a blank.
// THE ROW'S DOM IDENTITY IS DELIBERATELY OPAQUE (fix round, findings
// CR-M3P13-01 and HZ-M3P13-05). data-group-key used to be
// maskCardNumbers(group.key), and the card mask does not touch an account
// number, so every account-basis row carried the counterparty account in full
// in a DOM attribute on the screen whose headline criterion reads "THE
// ACCOUNT NEVER LEAVES THE DISPLAY LAYER UNMASKED".
//
// IT WAS EXCLUDED FROM THAT CRITERION'S SWEEP AS NECESSARY AND IT IS NOT
// NECESSARY. The argument given was that masking the key would collide two
// accounts sharing a country, check digits and last four characters and break
// criterion 11.3's row identity. Criterion 11.3 says the attribute is added
// MASKED and accepts that collision in terms (finding DELTA-M0P4-08), so the
// argument was wrong about the criterion; but the collision itself is real
// for the OTHER consumer, the client naming-claims store, which keys on this
// value. A DIGEST answers both: it carries no identifier, and it stays
// injective wherever the key is, so no claim can land on a sibling row.
//
// WHAT THE DIGEST IS NOT, AND THIS IS THE PART A LATER PHASE WILL NEED
// (round two, finding HZ2-M3P13-03). IT IS A STABLE OPAQUE ROW IDENTITY. IT
// IS NOT A REDACTION. The value hashed has low entropy and the same row
// displays the masked label, which round one measured as leaving about
// 1.03e6 candidate accounts for the Belgian length, so anyone holding the
// markup can hash a million candidates in seconds and recover the account
// from this attribute. That costs nothing TODAY only because the same row
// carries the account in plaintext in the hidden naming field by design, so
// this digest is not the weakest link on the row.
//
// THE DAY THAT CHANGES: if a later phase makes the hidden identity field
// opaque, believing the row is then clean, this digest becomes the whole
// exposure and the account will simply have moved from one attribute to
// another. That change must give this digest a PER-HOUSEHOLD SALT held
// server side, in the same commit, or it does not do what it thinks it does.
//
// Every consumer needs stability and uniqueness and nothing else: criterion
// 11.3's sweep compares the sequence to itself (test/e2e/busy-state.spec.ts),
// the optimistic-naming spec captures a value and uses it to re-find its own
// row, and naming-claims.ts uses it as half of an equality. THE VALUE IS NOT
// A KEY AND MUST NOT BE TURNED BACK INTO ONE: a later phase that helpfully
// restores group.key here puts the account back in the markup of every row.
const groupDomId = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 16);

const GroupBasis = async ({ basis }: { readonly basis: "account" | "descriptor" }) => {
  const t = await getTranslations();
  return (
    <p className="merchant-row-basis" data-testid="group-basis">
      {basis === "account" ? t("groupBasisAccount") : t("groupBasisDescriptor")}
    </p>
  );
};

// THE REACH IS THE GROUP'S OWN ROW COUNT, never a prediction (hazard H13.6).
// It is the same number the row prints beside the label, taken from the same
// field, so the two can never disagree.
const GroupReach = async ({ count }: { readonly count: number }) => {
  const t = await getTranslations();
  return (
    <p className="merchant-row-reach" data-testid="group-reach">
      {t("groupReach", { count })}
    </p>
  );
};

// THE TRANSACTIONS BEHIND THE GROUP (criterion 13.3). A native disclosure,
// so it opens with no JavaScript and carries its own accessible name; no new
// client component and no new server action, and the rows come from the same
// read that built the groups (M3-P13 step 5).
//
// Each line renders the row's OWN booking date, its OWN amount through the
// mandatory money rendering, and its OWN description. The description is raw
// source text, so it is masked HERE, in the rendering, twice over: the card
// mask this screen already applied to the label, and the account mask this
// phase adds, because a transfer descriptor carries the counterparty account
// in full and putting those lines on screen would otherwise create hazard
// H13.2 rather than answer it.
//
// IT IS A FUNCTION RETURNING MARKUP, NOT A COMPONENT RENDERED AS AN ELEMENT,
// AND THAT IS LOAD-BEARING (fix round). It was `<GroupRows rows={group.rows} />`
// placed in the `detail` object, which is a prop of the CLIENT component
// MerchantGroupRow. A React ELEMENT in a client component's props is
// serialised into the flight payload TOGETHER WITH ITS OWN PROPS, so the raw
// `rows` array crossed the boundary and every unmasked description, account
// numbers included, was in a script element on the page. Measured directly:
// the page source carried the whole raw descriptor of the two-token row, in
// JSON, beside its id and booking date. Calling the function here means the
// value that becomes a prop is a tree of HOST elements whose children are the
// already-masked strings, so nothing raw is left to serialise.
//
// MECHANISM RULE, RECORDED AT THE DEFINITION (clause mechanism-sibling). The
// mechanism is HANDING A SERVER-RENDERED SUBTREE TO A CLIENT COMPONENT. Its
// rule: pass the RESULT, never an element whose props hold data the screen
// does not render. Serialisation follows the element, not the pixels, so a
// prop that is never displayed still ships. THE SIBLING SITES in this tree
// are the other two detail slots below (both carry only a short union or a
// number) and the `copy` prop of MerchantGroupRow, which is already resolved
// to strings for the same class of reason (criterion 11.7(e)).
const groupRowsMarkup = async (
  rows: readonly ReviewGroupRow[],
): Promise<ReactNode> => {
  const t = await getTranslations();
  return (
    <details className="merchant-row-detail" data-testid="group-rows">
      <summary className="merchant-row-detail-summary">
        {t("groupRowsShow")}
      </summary>
      <ul className="merchant-txn-list">
        {rows.map((row) => (
          <li className="merchant-txn" data-testid="group-row" key={row.id}>
            <span className="merchant-txn-date" data-testid="group-row-date">
              {row.bookingDate}
            </span>
            <span
              className="merchant-txn-description"
              data-testid="group-row-description"
            >
              {maskAccountNumbers(maskCardNumbers(row.description))}
            </span>
            <span
              className="merchant-txn-amount"
              data-testid="group-row-amount"
            >
              <Amount cents={row.amountCents} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
};

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
  // (criterion 11.3), as the opaque digest described above rather than as
  // the key itself (fix round, findings CR-M3P13-01 and HZ-M3P13-05).
  if (unresolved && group.unnameableReason !== undefined) {
    return (
      <li
        className="merchant-row merchant-row-unresolved"
        data-testid="unresolved-group"
        data-group-key={groupDomId(group.key)}
      >
        <span className="merchant-row-label" data-testid="group-label">
          {t("unnameableLabel")}
        </span>
        <span className="merchant-row-count" data-testid="group-count">
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
        {/* The basis is stated on EVERY unresolved group, this one included
            (M3-P13 step 2). No reach line: there is no form here, and a
            sentence about how far a naming would reach on a row that offers
            no naming would be a promise about a control the screen does not
            show. */}
        {group.basis === undefined ? null : <GroupBasis basis={group.basis} />}
        {await groupRowsMarkup(group.rows)}
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
      // The row's stable DOM identity, an OPAQUE DIGEST of the key
      // (criterion 11.3, finding DELTA-M0P4-08, and this round's findings
      // CR-M3P13-01 and HZ-M3P13-05). It used to be the key put through the
      // card mask, which for a descriptor group is the descriptor and for an
      // account group is the account in full. Criterion 11.3 only ever
      // compares the sequence to itself, so an opaque value serves it
      // exactly as well and carries no identifier at all.
      groupKey={groupDomId(group.key)}
      // The label of an unresolved group is the normalised descriptor for
      // a descriptor-basis group, so a card descriptor rendered the card
      // number here. Masked in the RENDERING only (M3-P6, decision D-12):
      // the hidden counterpartyText field inside the leaf stays UNMASKED,
      // because that value is the counterparty IDENTITY KEY that becomes
      // the EXACT MerchantRule pattern, and a masked subject would match
      // nothing.
      // DECISION D-41, THE DISPLAY HALF. An account-basis group with no
      // carried counterparty name hands over its ACCOUNT, and the account is
      // masked HERE, in the display layer, exactly as the card number beside
      // it is. The unmasked value never enters the key: the hidden field
      // below still carries group.counterpartyText, which is the namespaced
      // identity key and the exact rule subject (hazard H13.1).
      label={
        group.accountAlias === undefined
          ? maskAccountNumbers(maskCardNumbers(group.label))
          : maskAccountNumbers(group.accountAlias)
      }
      countText={`${group.count} ${t("rows")}`}
      totalCents={group.totalCents}
      unresolved={unresolved}
      direction={direction}
      copy={copy}
      detail={{
        ...(unresolved && group.basis !== undefined
          ? { beforeForm: <GroupBasis basis={group.basis} /> }
          : {}),
        ...(unresolved && group.counterpartyText !== undefined
          ? { inForm: <GroupReach count={group.count} /> }
          : {}),
        // AWAITED HERE, so what becomes a prop is the MARKUP and not an
        // element carrying the raw rows. The two slots above pass elements
        // whose only props are a two-value union and a number, neither of
        // which is data the screen withholds; this one carried every raw
        // description on the screen. See groupRowsMarkup.
        afterForm: await groupRowsMarkup(group.rows),
      }}
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
