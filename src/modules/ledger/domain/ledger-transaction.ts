// The ledger module's own view of a transaction: exactly the FACT fields
// interpretation is allowed to read (pulse-domain section 2). Interpretation
// never sees or touches rawLine, dedup keys or import bookkeeping; it is
// derived from these fields plus the user's declarations and is entirely
// rebuildable.

import type { Cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";

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
// the total the statement carries when it carries one; a CSV statement
// carries none, so v1 computes the sum of its line items, meaning the
// magnitude of its debit rows. Settlement credit rows (the previous
// statement's settlement arriving on the card) are not line items.
export type CardImportSummary = {
  readonly importId: string;
  readonly accountId: string;
  readonly settlementTotalCents: Cents;
  readonly periodEnd: PlainDate;
};

export const summarizeCardImports = (
  transactions: readonly LedgerTransaction[],
  sets: DeclaredSets,
): readonly CardImportSummary[] => {
  const byImport = new Map<
    string,
    { accountId: string; total: number; periodEnd: PlainDate }
  >();
  for (const transaction of transactions) {
    if (!sets.cardAccountIds.has(transaction.accountId)) {
      continue;
    }
    const entry = byImport.get(transaction.importId);
    if (entry === undefined) {
      byImport.set(transaction.importId, {
        accountId: transaction.accountId,
        total: transaction.amountCents < 0 ? -transaction.amountCents : 0,
        periodEnd: transaction.bookingDate,
      });
      continue;
    }
    if (transaction.amountCents < 0) {
      entry.total += -transaction.amountCents;
    }
    if (transaction.bookingDate > entry.periodEnd) {
      entry.periodEnd = transaction.bookingDate;
    }
  }
  return [...byImport.entries()]
    .map(([importId, entry]) => ({
      importId,
      accountId: entry.accountId,
      settlementTotalCents: entry.total as Cents,
      periodEnd: entry.periodEnd,
    }))
    .sort((a, b) => (a.importId < b.importId ? -1 : 1));
};
