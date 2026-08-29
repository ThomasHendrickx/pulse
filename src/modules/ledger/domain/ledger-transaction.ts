// The ledger module's own view of a transaction: exactly the FACT fields
// interpretation is allowed to read (pulse-domain section 2). Interpretation
// never sees or touches rawLine, dedup keys or import bookkeeping; it is
// derived from these fields plus the user's declarations and is entirely
// rebuildable.

import { canonicalAccountNumber } from "@/platform/account-number";
import type { Cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";
import { SETTLEMENT_CREDIT_PATTERNS, matchesAny } from "./constants";

export type LedgerTransaction = {
  readonly id: string;
  readonly accountId: string;
  readonly importId: string;
  readonly bookingDate: PlainDate;
  // Signed integer cents: negative leaves the pot, positive enters.
  readonly amountCents: Cents;
  readonly description: string;
  readonly counterpartyIban?: string;
  readonly counterpartyName?: string;
};

// The declaration-layer slice interpretation reads: each account's ring and
// IBAN. Declared by the user at first sight, never inferred (pulse-domain
// section 1). The role union is structural on purpose: the ledger domain
// imports nothing from other modules, and "POT" | "RESERVE" is the same
// declared vocabulary the accounts module publishes.
export type DeclaredAccount = {
  readonly id: string;
  readonly role: "POT" | "RESERVE";
  readonly iban?: string;
};

// Derived, not declared: the sets classification runs against. The
// reserve set is a set of IBANs: a reserve account's own rows never enter
// the interpretation window, so classification only ever meets a reserve
// account as a COUNTERPARTY. (This sentence used to say reserve statements
// are not imported; DR-0030 made that false in M3-P18, corrected here
// rather than quietly deleted: a savings statement's rows are now imported
// as HELD facts, still outside the window.) Pot accounts with an IBAN form
// the pot set; pot accounts WITHOUT an IBAN are card accounts (the observed
// card export shape carries no own-account identifier; such accounts are
// recognised through their bound SourceProfile at import time).
export type DeclaredSets = {
  readonly reserveIbans: ReadonlySet<string>;
  readonly potIbans: ReadonlySet<string>;
  readonly potIbanToAccountId: ReadonlyMap<string, string>;
  readonly potAccountIds: ReadonlySet<string>;
  readonly cardAccountIds: ReadonlySet<string>;
};

export const deriveDeclaredSets = (
  accounts: readonly DeclaredAccount[],
): DeclaredSets => {
  const reserveIbans = new Set<string>();
  const potIbans = new Set<string>();
  const potIbanToAccountId = new Map<string, string>();
  const potAccountIds = new Set<string>();
  const cardAccountIds = new Set<string>();
  // EVERY SET IS KEYED ON THE CANONICAL FORM (M3-P14, criterion 14.4).
  // A declaration is stored canonical, but the account number on a FACT row
  // is whatever the source printed: the delimited parser stores the cell
  // verbatim and a Belgian statement prints its accounts SPACED. Comparing
  // raw stored strings answers "different account" for one account written
  // two ways, so both sides canonicalise at comparison time and the fact
  // column is never rewritten (pulse-domain section 2, rule 1). The
  // comparison side is classify-flow.ts, corrections.ts and
  // pair-transfers.ts; the rule and its siblings are recorded at the
  // canonical form's definition in src/platform/account-number.ts.
  for (const account of accounts) {
    if (account.role === "RESERVE") {
      if (account.iban !== undefined) {
        reserveIbans.add(canonicalAccountNumber(account.iban));
      }
      continue;
    }
    potAccountIds.add(account.id);
    if (account.iban === undefined) {
      cardAccountIds.add(account.id);
    } else {
      const canonical = canonicalAccountNumber(account.iban);
      potIbans.add(canonical);
      potIbanToAccountId.set(canonical, account.id);
    }
  }
  return { reserveIbans, potIbans, potIbanToAccountId, potAccountIds, cardAccountIds };
};

// One imported card statement, summarised for settlement matching
// (owner v0.2 addendum section 5, decision D-11): its settlement total is
// the figure the statement carries when it carries one, and otherwise the
// NET OF ITS LINE ITEMS, which is what that printed figure is. Settlement
// credit rows (the previous statement's settlement arriving on the card)
// are not line items and are excluded from the net.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round 2, finding
// HZ-M3P3-01). The sentence above used to read "a CSV statement carries
// none, so v1 computes the sum of its line items", and it described what
// this function did for EVERY card import, including one whose statement
// does carry the figure. It was true when written, in a world where no
// PDF card statement could be imported at all; phase M3-P3 made card PDFs
// importable and nothing here changed, so the code went on re-deriving a
// number the document had already stated. The two agree only when the
// statement carries no positive row other than the settlement credit. ONE
// ORDINARY MERCHANT REFUND separates them by exactly the refund: the
// account-side direct debit then matches no card import, falls through to
// the honest-unitemised SPEND arm, and the month counts both that whole
// debit and the card's own rows, with the mirror credit left as an
// unmatched INTERNAL leg. statementSettlementTotals below carries the
// document's own figure; the derivation is the FALLBACK, reached only by
// an import whose source printed no such figure.
//
// CORRECTED AGAIN IN FIX ROUND 3 (R-087, finding HZ2-M3P3-01), because the
// round-2 correction above fixed the defect only where a figure is stored
// and left the identical defect live where none is. ONLY THE PDF PATH
// STORES ONE. A card account is a pot account with no IBAN whatever format
// its statements arrive in, this tree ships four delimited card-export
// fixtures, and a delimited parse sets no figure, so the fallback is a
// LIVE path and not a theoretical one: it is the path v0.1 shipped. The
// fallback used to be the sum of the MAGNITUDES OF THE DEBIT ROWS, which
// is wrong by exactly any ordinary merchant refund, which is the defect
// this whole round exists to remove. It is now the NET of the line items,
// excluding the settlement credit, which is the definition of the printed
// figure: opening plus every row equals the printed total, and the credit
// cancels the opening, so what remains is the net of everything else.
// CORRECTED AGAIN IN FIX ROUND 4 (R-087, finding HZ3-M3P3-01), because the
// paragraph above ended with a claim that was FALSE AND FORECLOSING. It
// said the net "is never worse than the sum it replaced: the two are equal
// unless the statement carries a positive row that is not the settlement
// credit, and in that case the old one is certainly wrong". A settlement
// credit whose wording SETTLEMENT_CREDIT_PATTERNS does not match is a
// positive row this code treats as not the settlement credit, so the
// escape clause fired on precisely the case that breaks the claim, and on
// that case the net is wrong by the whole credit while the old sum was
// right. It was demonstrated end to end: the account-side debit fell from
// INTERNAL to SPEND, no settlement link was made, and the month double
// counted. The pattern is ONE Dutch regex read off ONE observed statement,
// and this derivation is by construction the path for sources nobody has
// observed, so depending on it here was the wrong shape of dependency.
//
// WHAT THE CODE DOES NOW, instead of picking. The two derivations differ
// by exactly the positive rows the pattern did not claim, and from the
// rows alone NOTHING can tell an unrecognised settlement credit from an
// ordinary merchant refund: one makes the old sum right, the other makes
// the net right. So the summary carries BOTH as candidate totals and the
// account-side debit matches either. That is not a guess dressed up as an
// answer: a debit equal to a candidate IS the evidence that the candidate
// is what the issuer collected, and a debit equal to neither still finds
// no match and is still loud. A stored printed figure collapses the
// candidates to itself, because the document said so and the rows only
// ever approximated it.
//
// WHERE NO DERIVATION IS THE TRUTH, enumerated rather than gestured at,
// and each one LOUD (measured: debit at SPEND, zero settlement links, the
// books open, so the household sees a gap rather than a quiet number).
// UNDERPAYMENT of a previous statement, where the credit does not cancel
// the opening. OVERPAYMENT, the same in the other direction. A settlement
// credit that ARRIVES AFTER the statement's cut-off, so the month carries
// no credit at all. In all three the rows genuinely do not contain the
// printed figure, which is exactly why a printed figure is stored and
// always wins.
export type CardImportSummary = {
  readonly importId: string;
  readonly accountId: string;
  // EVERY total this import could plausibly settle for, deduplicated, in
  // signed integer cents. One entry when the statement printed a figure or
  // when both derivations agree, which is every card month with no
  // positive row beyond a recognised settlement credit. Two when they
  // disagree, which is the ambiguity the rows cannot resolve.
  readonly settlementTotalsCents: readonly Cents[];
  readonly periodEnd: PlainDate;
};

// A card-side settlement credit: positive, and matching the ONE
// code-owned credit pattern the classification step matches
// (corrections.ts correction 1). Same predicate, same source of truth, so
// a row the classifier calls the mirror leg is the same row this
// summariser leaves out of the net.
const isSettlementCreditRow = (transaction: LedgerTransaction): boolean =>
  transaction.amountCents > 0 &&
  matchesAny(transaction.description, SETTLEMENT_CREDIT_PATTERNS);

export const summarizeCardImports = (
  transactions: readonly LedgerTransaction[],
  sets: DeclaredSets,
  // Import id to the settlement figure ITS OWN STATEMENT carries, in
  // positive integer cents, read from the stored fact column. An import
  // absent from this map printed no such figure and takes the row-sum
  // fallback below.
  statementSettlementTotals?: ReadonlyMap<string, Cents>,
): readonly CardImportSummary[] => {
  const byImport = new Map<
    string,
    {
      accountId: string;
      // The net of the line items, excluding every RECOGNISED settlement
      // credit: right whenever the pattern claimed every credit there is.
      net: number;
      // The sum of the magnitudes of the debit rows: right whenever every
      // positive row on the statement is a settlement credit, recognised
      // or not. The two are equal unless an unclaimed positive row exists.
      debitSum: number;
      periodEnd: PlainDate;
    }
  >();
  for (const transaction of transactions) {
    if (!sets.cardAccountIds.has(transaction.accountId)) {
      continue;
    }
    // The settlement credit is not a line item: it is the PREVIOUS
    // statement's settlement arriving on the card, and the same
    // code-owned pattern the classification step uses recognises it, so
    // the two cannot drift apart.
    const net = isSettlementCreditRow(transaction)
      ? 0
      : -transaction.amountCents;
    const debitSum =
      transaction.amountCents < 0 ? -transaction.amountCents : 0;
    const entry = byImport.get(transaction.importId);
    if (entry === undefined) {
      byImport.set(transaction.importId, {
        accountId: transaction.accountId,
        net,
        debitSum,
        periodEnd: transaction.bookingDate,
      });
      continue;
    }
    entry.net += net;
    entry.debitSum += debitSum;
    if (transaction.bookingDate > entry.periodEnd) {
      entry.periodEnd = transaction.bookingDate;
    }
  }
  return [...byImport.entries()]
    .map(([importId, entry]) => {
      const printed = statementSettlementTotals?.get(importId);
      // The document's own figure ends the question: the derivations only
      // ever approximated what it states outright.
      const totals =
        printed !== undefined
          ? [printed]
          : [...new Set([entry.net, entry.debitSum])].map((v) => v as Cents);
      return {
        importId,
        accountId: entry.accountId,
        settlementTotalsCents: totals,
        periodEnd: entry.periodEnd,
      };
    })
    .sort((a, b) => (a.importId < b.importId ? -1 : 1));
};
