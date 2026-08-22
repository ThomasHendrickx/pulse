// The ledger module's own view of a transaction: exactly the FACT fields
// interpretation is allowed to read (pulse-domain section 2). Interpretation
// never sees or touches rawLine, dedup keys or import bookkeeping; it is
// derived from these fields plus the user's declarations and is entirely
// rebuildable.

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

// Derived, not declared: the sets classification runs against. Reserve
// accounts are registered by IBAN only (their statements are not imported),
// so the reserve set is a set of IBANs. Pot accounts with an IBAN form the
// pot set; pot accounts WITHOUT an IBAN are card accounts (the observed
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
  for (const account of accounts) {
    if (account.role === "RESERVE") {
      if (account.iban !== undefined) {
        reserveIbans.add(account.iban);
      }
      continue;
    }
    potAccountIds.add(account.id);
    if (account.iban === undefined) {
      cardAccountIds.add(account.id);
    } else {
      potIbans.add(account.iban);
      potIbanToAccountId.set(account.iban, account.id);
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
// WHERE THE DERIVATION IS STILL NOT THE TRUTH, said plainly rather than
// left for the next reviewer: if a previous statement was underpaid the
// credit does not cancel the opening and no derivation from rows alone can
// recover the printed figure. That is exactly why a printed figure is
// stored and always wins. The derivation is the best available answer for
// a source that prints nothing, and it is never worse than the sum it
// replaced: the two are equal unless the statement carries a positive row
// that is not the settlement credit, and in that case the old one is
// certainly wrong.
export type CardImportSummary = {
  readonly importId: string;
  readonly accountId: string;
  readonly settlementTotalCents: Cents;
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
    { accountId: string; total: number; periodEnd: PlainDate }
  >();
  for (const transaction of transactions) {
    if (!sets.cardAccountIds.has(transaction.accountId)) {
      continue;
    }
    // The settlement credit is not a line item: it is the PREVIOUS
    // statement's settlement arriving on the card, and the same
    // code-owned pattern the classification step uses recognises it, so
    // the two cannot drift apart.
    const contribution = isSettlementCreditRow(transaction)
      ? 0
      : -transaction.amountCents;
    const entry = byImport.get(transaction.importId);
    if (entry === undefined) {
      byImport.set(transaction.importId, {
        accountId: transaction.accountId,
        total: contribution,
        periodEnd: transaction.bookingDate,
      });
      continue;
    }
    entry.total += contribution;
    if (transaction.bookingDate > entry.periodEnd) {
      entry.periodEnd = transaction.bookingDate;
    }
  }
  return [...byImport.entries()]
    .map(([importId, entry]) => ({
      importId,
      accountId: entry.accountId,
      // The statement's own figure wins whenever the statement carried
      // one; the row sum is the fallback for a source that prints none.
      settlementTotalCents:
        statementSettlementTotals?.get(importId) ?? (entry.total as Cents),
      periodEnd: entry.periodEnd,
    }))
    .sort((a, b) => (a.importId < b.importId ? -1 : 1));
};
