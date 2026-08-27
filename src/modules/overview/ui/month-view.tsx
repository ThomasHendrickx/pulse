import Link from "next/link";
import { LinkPending } from "@/platform/ui/link-pending";
import { getLocale, getTranslations } from "next-intl/server";
import { Amount, formatCents } from "@/platform/ui/amount";
import { maskCardNumbers } from "@/platform/ui/mask-card-number";
import type { HouseholdContext } from "@/platform/tenancy";
import { getMonthOverview, nextMonth as nextMonthOf } from "../application";
import type {
  GapRow,
  Month,
  MonthOverview,
  OverviewGroup,
} from "../application";

// The month view, rebuilt ONE COLUMN AT PHONE WIDTH in M3-P7 under
// DR-0022 against delivery/design/mobile-v02/Main.dc.html and
// BooksDoNotClose.dc.html. The reconciliation panel comes FIRST in DOM
// order, because whether the books close is the first thing the screen
// answers (mockup README fix 5); income, spend and reserves follow in that
// order and stack (README fix 6). At the one breakpoint the rail returns
// as a widening of that column, produced by grid placement in the
// stylesheet, so nothing here reorders and the order assistive technology
// reads is the order the phone shows. The panel SHIPS in the view, never
// behind a flag. Server components only; there is no client state here,
// the whole screen is a projection of one read (pulse-frontend sections 1
// and 2).
//
// EVERY ROW IS TWO LINES (mockup README fix 1): name and amount on line
// one, row count and month-over-month delta on line two. The three-track
// row that preceded it left the counterparty name about 116 CSS pixels at
// 390, and that row is why this phase exists.
//
// The states that matter (pulse-frontend section 5) all render here: the
// empty state before the first import, the partial current month (in
// progress, never compared), books that do not reconcile (the only place
// --color-alarm appears), unresolved counterparties (flag, already
// counted), and unmatched transfer legs (flag, excluded, the missing
// export named). Never hide an unknown to make the screen look clean.

const monthDate = (month: Month): Date => {
  const [yearText, monthText] = month.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1));
};

const monthTitle = (month: Month, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate(month));

const monthName = (month: Month, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    monthDate(month),
  );

// Magnitude change against the previous closed month: direction glyphs
// carry no verdict (both directions render in ink, pulse-frontend
// section 3: income and spend are directions, not verdicts).
const Delta = ({ deltaCents }: { readonly deltaCents: number }) => {
  if (deltaCents === 0) {
    return <span className="month-delta">{"="}</span>;
  }
  return (
    <span className="month-delta pulse-amount">
      {deltaCents > 0 ? "↑" : "↓"}
      {" "}
      {formatCents(Math.abs(deltaCents))}
    </span>
  );
};

// Signed rendering for the reserves block: an explicit plus marks the
// parked direction, a minus a drawdown; zero is plain.
const SignedAmount = ({ cents }: { readonly cents: number }) => (
  <span className="pulse-amount">
    {cents > 0 ? "+" : ""}
    {formatCents(cents)}
  </span>
);

// The group label for an UNRESOLVED counterparty IS the normalised
// descriptor (month-projection.ts sets it to the same string it uses as the
// key), so a card descriptor put the card number on screen. Masking happens
// HERE, in the rendering, and reaches nothing else: the key, the fact and
// the value the review form submits all stay verbatim (M3-P6, decision
// D-12, see src/platform/ui/mask-card-number.ts).
const GroupLabel = async ({ group }: { readonly group: OverviewGroup }) => {
  const t = await getTranslations();
  return (
    <span
      className={
        group.kind === "unresolved"
          ? "month-group-label month-group-unresolved"
          : "month-group-label"
      }
      data-testid="group-label"
    >
      {group.kind === "cash" ? t("cash") : maskCardNumbers(group.label)}
    </span>
  );
};

const SpendBlock = async ({
  overview,
  locale,
}: {
  readonly overview: MonthOverview;
  readonly locale: string;
}) => {
  const t = await getTranslations();
  return (
    <section className="month-card month-spend" data-testid="spend-card">
      <header className="month-card-header">
        <h2>{t("spend")}</h2>
        <span className="month-card-total">
          {overview.compared && overview.spend.deltaCents !== undefined ? (
            <span data-testid="spend-delta">
              <Delta deltaCents={overview.spend.deltaCents} />
            </span>
          ) : null}
          <span data-testid="spend-total">
            <Amount cents={overview.spend.totalCents} />
          </span>
        </span>
      </header>
      <div className="month-columns pulse-eyebrow">
        <span>{t("counterparty")}</span>
        <span className="month-col-amount">{t("amount")}</span>
        <span className="month-col-compare" data-testid="compare-head">
          {overview.compared ? (
            t("vsMonth", { month: monthName(overview.previous, locale) })
          ) : (
            <span data-testid="compare-na">{t("notCompared")}</span>
          )}
        </span>
      </div>
      <ul className="month-list">
        {overview.spend.groups.map((group) => (
          <li key={group.key} className="month-row" data-testid="spend-group">
            <GroupLabel group={group} />
            <span
              className="month-row-amount pulse-amount"
              data-testid="group-total"
            >
              <Amount cents={0 - group.totalCents} />
            </span>
            <span className="month-row-count month-row-meta">
              {group.rowCount}
              {" "}
              {t("rows")}
            </span>
            {overview.compared && group.deltaCents !== undefined ? (
              <span className="month-row-delta" data-testid="group-delta">
                <Delta deltaCents={group.deltaCents} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {overview.figures.rowCount === 0 ? (
        <p className="month-note" data-testid="month-no-rows">
          {t("monthNoRows")}
        </p>
      ) : null}
    </section>
  );
};

const IncomeBlock = async ({
  overview,
}: {
  readonly overview: MonthOverview;
}) => {
  const t = await getTranslations();
  return (
    <section className="month-card month-income" data-testid="income-card">
      <header className="month-card-header">
        <h2>{t("income")}</h2>
        <span className="month-card-total" data-testid="income-total">
          <Amount cents={overview.income.totalCents} />
        </span>
      </header>
      <ul className="month-list">
        {overview.income.groups.map((group) => (
          <li key={group.key} className="month-row" data-testid="income-group">
            <GroupLabel group={group} />
            <span
              className="month-row-amount pulse-amount"
              data-testid="group-total"
            >
              <Amount cents={group.totalCents} />
            </span>
            <span className="month-row-count month-row-meta">
              {group.rowCount}
              {" "}
              {t("rows")}
            </span>
            {overview.compared && group.deltaCents !== undefined ? (
              <span className="month-row-delta" data-testid="group-delta">
                <Delta deltaCents={group.deltaCents} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

const ReservesBlock = async ({
  overview,
}: {
  readonly overview: MonthOverview;
}) => {
  const t = await getTranslations();
  return (
    <section className="month-card month-reserves" data-testid="reserves-card">
      <header className="month-card-header">
        <div>
          <h2>{t("reserves")}</h2>
          <div className="pulse-eyebrow">{t("netMovement")}</div>
        </div>
        <span className="month-card-total" data-testid="reserves-net">
          <SignedAmount cents={overview.reserves.netCents} />
        </span>
      </header>
      <ul className="month-list">
        {overview.reserves.groups.map((group) => (
          <li
            key={group.counterpartyIban}
            className="month-row"
            data-testid="reserve-group"
          >
            <span className="month-group-label">{group.label}</span>
            <span
              className="month-row-amount pulse-amount"
              data-testid="group-total"
            >
              <SignedAmount cents={group.parkedCents} />
            </span>
            <span className="month-row-count month-row-meta">
              {group.rowCount}
              {" "}
              {t("rows")}
            </span>
          </li>
        ))}
      </ul>
      {overview.reserves.groups.length === 0 ? (
        <p className="month-note" data-testid="no-reserves">
          {t("noReserves")}
        </p>
      ) : null}
    </section>
  );
};

const GapList = ({
  rows,
  testId,
  tone,
}: {
  readonly rows: readonly GapRow[];
  readonly testId: string;
  // "flag": needs attention (gaps). "plain": matched and correct rows
  // that are merely named (in transit); flag colour would cry wolf.
  readonly tone: "flag" | "plain";
}) => (
  <ul className="recon-gap-list">
    {rows.map((row) => (
      <li key={row.id} className="recon-gap-row" data-testid={testId}>
        {/* The gap row renders the UNNORMALISED counterparty text, so no
            strip pattern has run on it: masked here for the same reason the
            group label above is (M3-P6 fix round 1, finding CR-M3P6-03). */}
        <span className={tone === "flag" ? "month-group-unresolved" : undefined}>
          {maskCardNumbers(row.text)}
        </span>
        <span className="month-row-meta">
          {row.bookingDate}
          {" · "}
          {row.accountLabel}
        </span>
        <Amount cents={row.amountCents} />
      </li>
    ))}
  </ul>
);

const ReconciliationPanel = async ({
  overview,
}: {
  readonly overview: MonthOverview;
}) => {
  const t = await getTranslations();
  const figures = overview.figures;
  const amt = (chunks: React.ReactNode) => (
    <span className="pulse-amount">{chunks}</span>
  );
  const parts: readonly {
    readonly op: string;
    readonly testId: string;
    readonly valueCents: number;
    readonly label: string;
    readonly alarm: boolean;
  }[] = [
    { op: "", testId: "recon-income", valueCents: figures.incomeCents, label: t("income"), alarm: false },
    { op: "−", testId: "recon-spend", valueCents: figures.spendCents, label: t("spend"), alarm: false },
    { op: "−", testId: "recon-reserves", valueCents: figures.netToReservesCents, label: t("reserves"), alarm: false },
    { op: "=", testId: "recon-pot", valueCents: figures.changeInPotCents, label: t("potChange"), alarm: !figures.reconciles },
    ...(figures.differenceCents === 0
      ? []
      : [{ op: "≠", testId: "recon-difference", valueCents: figures.differenceCents, label: t("difference"), alarm: true }]),
  ];
  return (
    <section
      className="recon-panel"
      data-testid="recon-panel"
      data-state={figures.reconciles ? "ok" : "broken"}
    >
      <div className="recon-strip">
        <span
          className="pulse-eyebrow recon-verdict"
          data-testid="recon-verdict"
        >
          {figures.reconciles ? t("reconciles") : t("reconBroken")}
        </span>
        <div className="recon-parts">
          {parts.map((part) => (
            <span key={part.testId} className="recon-part">
              <span className="recon-op">{part.op}</span>
              <span
                className={part.alarm ? "pulse-amount recon-alarm" : "pulse-amount"}
                data-testid={part.testId}
              >
                {formatCents(part.valueCents)}
              </span>
              <span className="pulse-eyebrow recon-part-label">{part.label}</span>
            </span>
          ))}
        </div>
        <p className="recon-note">
          {figures.reconciles
            ? overview.partial
              ? t("reconNotePartial")
              : t("reconNoteOk")
            : figures.differenceCents !== 0
              ? t.rich("reconNoteBad", {
                  amount: formatCents(figures.differenceCents),
                  amt,
                })
              : t("reconNoteGaps")}
        </p>
      </div>
      {figures.uninterpretedCount > 0 ? (
        <div className="recon-cause" data-testid="recon-cause-uninterpreted">
          <p className="recon-cause-text">
            {t("uninterpretedCause", { count: figures.uninterpretedCount })}
          </p>
          <GapList
            rows={overview.uninterpretedRows}
            testId="uninterpreted-row"
            tone="flag"
          />
        </div>
      ) : null}
      {figures.unmatchedInternalCount > 0 ? (
        <div className="recon-cause" data-testid="recon-cause-unmatched">
          <p className="recon-cause-text">
            {t.rich("unmatchedCause", {
              count: figures.unmatchedInternalCount,
              amount: formatCents(figures.unmatchedInternalCents),
              amt,
            })}
          </p>
          <GapList rows={overview.unmatchedLegs} testId="unmatched-leg" tone="flag" />
        </div>
      ) : null}
      {figures.inTransitCount > 0 ? (
        <div className="recon-cause" data-testid="recon-cause-in-transit">
          <p className="recon-cause-text">
            {t.rich("inTransitCause", {
              count: figures.inTransitCount,
              amount: formatCents(figures.inTransitCents),
              amt,
            })}
          </p>
          <GapList
            rows={overview.inTransitLegs}
            testId="in-transit-leg"
            tone="plain"
          />
        </div>
      ) : null}
      {figures.unresolvedCount > 0 ? (
        <div className="recon-cause" data-testid="recon-cause-unresolved">
          <p className="recon-cause-text">
            {t.rich("unresolvedCause", {
              count: figures.unresolvedCount,
              amount: formatCents(figures.unresolvedCents),
              amt,
            })}
          </p>
          <GapList rows={overview.unresolvedRows} testId="unresolved-gap" tone="flag" />
        </div>
      ) : null}
    </section>
  );
};

const EmptyState = async () => {
  const t = await getTranslations();
  // The named action is reachable where it is named (M3-P1 step 2, owner
  // feedback DR-0002 item 1): a real link to the import screen, not copy
  // that only describes it.
  return (
    <section className="empty-state" data-testid="empty-state">
      <h1>{t("noData")}</h1>
      <p>{t("emptyTitle")}</p>
      <p>{t("emptyBody")}</p>
      {/* SETUP IS NAMED WHERE IT IS NEEDED (M3-P14, criterion 14.7). The
          first screen anyone sees now points at the accounts screen as
          well as the import screen, because a household that has
          registered nothing is sent there before the import screen will
          accept a file. */}
      <p>
        <Link
          href="/accounts"
          className="empty-state-cta"
          data-testid="empty-state-accounts-link"
        >
          {t("emptyAccountsCta")}
          <LinkPending />
        </Link>
      </p>
      <p>
        <Link
          href="/import"
          className="empty-state-cta"
          data-testid="empty-state-import-link"
        >
          {t("emptyImportCta")}
          <LinkPending />
        </Link>
      </p>
    </section>
  );
};

export const MonthScreen = async ({
  context,
  requestedMonth,
}: {
  readonly context: HouseholdContext;
  readonly requestedMonth?: string;
}) => {
  const [t, locale, overview] = await Promise.all([
    getTranslations(),
    getLocale(),
    getMonthOverview(context, requestedMonth),
  ]);
  if (!overview.hasAnyData) {
    return <EmptyState />;
  }
  const previousHref = `/?month=${overview.previous}`;
  const nextHref = `/?month=${nextMonthOf(overview.month)}`;
  return (
    <div className="month-screen">
      <header className="month-header">
        <div className="month-header-left">
          <div className="month-title-row">
            <Link
              className="month-nav"
              aria-label={t("prevMonthNav")}
              data-testid="month-step-previous"
              href={previousHref}
            >
              {"‹"}
              <LinkPending />
            </Link>
            <h1 data-testid="month-title">{monthTitle(overview.month, locale)}</h1>
            {overview.canGoNext ? (
              <Link
                className="month-nav"
                aria-label={t("nextMonthNav")}
                data-testid="month-step-next"
                href={nextHref}
              >
                {"›"}
                <LinkPending />
              </Link>
            ) : null}
            {overview.partial ? (
              <span className="month-progress-badge" data-testid="in-progress-badge">
                {t("inProgress")}
              </span>
            ) : null}
          </div>
          <div className="month-meta" data-testid="month-meta">
            {overview.partial ? (
              <span>
                {t("daysProgress", {
                  elapsed: overview.daysElapsed,
                  total: overview.daysInMonth,
                })}
                {" · "}
              </span>
            ) : null}
            <span>
              {overview.figures.rowCount}
              {" "}
              {t("rows")}
            </span>
          </div>
        </div>
        <div className="month-header-right">
          {overview.unresolvedCounterpartyCount > 0 ? (
            <Link
              className="month-unresolved-pill"
              data-testid="unresolved-pill"
              href="/merchants"
            >
              <span className="month-pill-dot" />
              {overview.unresolvedCounterpartyCount}
              {" "}
              {overview.unresolvedCounterpartyCount === 1
                ? t("unresolvedOne")
                : t("unresolvedMany")}
              <LinkPending />
            </Link>
          ) : null}
          <div className="month-pot">
            <div className="pulse-eyebrow">{t("potChange")}</div>
            <div className="month-pot-figure">
              <span className="month-pot-euro">{"€"}</span>
              <span className="pulse-amount" data-testid="pot-change">
                {formatCents(overview.figures.changeInPotCents)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* The reconciliation answer comes FIRST (mockup README fix 5,
          criterion 7.8): whether the books close is what the screen is
          for, and on a phone anything below the first screenful is a
          scroll the owner has to know to make. */}
      <ReconciliationPanel overview={overview} />

      {/* DOM order is income, spend, reserves, at every width. The rail at
          the one breakpoint is grid PLACEMENT in the stylesheet, never the
          order property, so this order is the order that is read
          (criterion 7.9). */}
      <div className="month-grid">
        <IncomeBlock overview={overview} />
        <SpendBlock overview={overview} locale={locale} />
        <ReservesBlock overview={overview} />
      </div>
    </div>
  );
};
