# Pulse v0.2 intake addendum: PDF import

Supersedes the parsing section of the v1 plan for v0.2 planning. Motivation:
the owner's mobile banking apps export PDF, not CSV. CSV remains v0.1; PDF is
the high-priority v0.2 input, and upload from a phone's share sheet is the
ease-of-use goal it unlocks.

Derived from two real statements (a Belfius current account
rekeninguittreksel and a KBC Mastercard uitgavenstaat). The real files are
parser examples for humans and agents to READ. They are never committed:
fixtures are synthetic derivatives that reproduce the format quirks listed in
section 6 with invented IBANs, names and amounts.

---

## 1. Architecture fit

PDF is a second adapter behind the existing `StatementParser` port. Nothing
upstream changes: identify, declare, ingest, interpret are untouched.

What changes is the profile concept. A delimited file is described by a
user-declarable `SourceProfile`. A PDF layout is not something a user can
declare by answering questions, so PDF sources use **layout templates owned
by code**, one per institution and document type, selected by fingerprint
(distinctive header text), never by asking the user. The ask-once
account-declaration step stays exactly as is; only the format question
disappears for recognised layouts. An unrecognised PDF layout fails the
import loudly with "layout not supported yet"; it is a backlog item, not a
user problem.

## 2. The balance contract

Both statement types carry an opening balance, the transactions, and a
closing balance or settlement total. That is a per-file checksum, and it
becomes a hard gate:

**opening + sum(parsed transactions) must equal closing, in integer cents,
or the import fails with status FAILED and writes nothing.**

This gate is what makes PDF extraction safe for the facts layer regardless
of extraction technique. A deterministic template that drops a line fails
loudly. And if a later iteration uses Claude to extract from an unknown
layout, the same gate holds: the model proposes, the balance identity
verifies, and only a reconciling parse reaches the ledger. LLM-assisted
extraction is therefore permitted in principle for v0.3+, but only behind
this check.

## 3. Layout template A: Belfius current account statement (NL)

- Fingerprint: "Belfius Bank NV" in the page header plus a "SALDO OP" line.
- Account identity: the IBAN in the band line between dashes.
- Every page repeats a header block; skip it. Pages whose body starts with
  "BIJLAGE BIJ VERRICHTING" are annexes (interest detail): skip entirely,
  they contain amount-like lines that are not transactions.
- Opening and closing are the first and last "SALDO OP <date> ... EUR
  <amount>" lines.
- A transaction starts with: sequence number (4 digits), booking date
  DD-MM-YYYY, "(VAL. <value date>)", then sign and amount at line end.
  Following indented lines up to the next transaction start are the
  description; join them into rawCounterparty/description and keep the
  block verbatim as rawLine.
- Amount format traps: decimal comma, thousands dot appears only from
  1.000,00 up, and the space between sign and amount disappears on large
  amounts ("- 3,55" but "-12.345,67"). The parser must accept both.
- Counterparty IBAN, when present, is inside the description ("STORTING VAN
  BE..", "OVERSCHRIJVING ... NAAR BE.."); extract by IBAN pattern. Many
  lines (card payments, fees) have none.
- Dedup natural key: account + year of booking date + sequence number. The
  sequence is per account and continuous across statements within a year.

## 4. Layout template B: KBC Mastercard uitgavenstaat

- Fingerprint: "KBC-Mastercard" plus "Uitgavenstaat".
- Account identity: the masked card number; the statement number and period
  ("Overzicht van je verrichtingen van X tot Y") scope the import.
- Row shape: transaction date, settlement date, description, amount.
  Booking date is the transaction date (spend lands in the month it
  happened), settlement date goes into the raw description.
- Continuation lines ("Bedrag 35 USD", "Koers (1 EUR = ...)") belong to the
  preceding row: FX detail, not transactions.
- "Vorig saldo op <date>" and the "Totaal bedrag ... / Afrekening via je
  bank op <date>" block are balances and summary, not transactions.
- The "DOMICILIERING VIA JE BANK" credit line IS a transaction: it is the
  settlement of the previous statement arriving on the card, the card-side
  leg of the settlement pair.
- No sequence numbers, so the hash dedup key applies, with the occurrence
  amendment below.

## 5. Two rule amendments the real data forces

**Dedup occurrence index (applies to v0.1 CSV too).** A real card statement
contained two rows identical in date, amount, counterparty and empty
reference within one file (two tap payments at the same operator). The
current hash key collides and would silently drop one. Amendment: the hash
key gains an occurrence index, the ordinal of that identical tuple within
the file; cross-import dedup keeps, per tuple, the highest occurrence count
seen. Add a fixture reproducing the identical pair, and a test asserting
both rows survive import and re-import.

**Card settlement without a counterparty IBAN.** The settlement debit on the
current account ("MASTERCARD AFREKENING NUMMER <n>") carries no IBAN, so the
declared-set rule cannot classify it INTERNAL. Amendment to classification,
between the declared-set checks and the sign fallback: a debit matching a
settlement pattern whose amount equals an imported card statement's
settlement total, within a date window, is `INTERNAL`, paired to that card
import. If no matching card import exists (a card whose statements the
household does not import), the settlement stays `SPEND` as an aggregate
against the card issuer as merchant, which is the honest reading of an
unitemised card.

## 6. Fixture requirements (synthetic, committed)

One synthetic Belfius-style and one synthetic KBC-card-style PDF (or their
extracted text, if the parser consumes a text layer) reproducing: variable
sign spacing with and without thousands dot, multi-line descriptions, an
annex page, a page break mid-transaction-list, FX continuation lines, the
settlement credit line, the identical-duplicate row pair, and opening plus
closing balances that reconcile. Plus one deliberately non-reconciling file
asserting the balance gate fails the import.

## 7. Mobile consequence, noted for v0.2 design

The v1 "desktop first, import is a desk activity" stance was downstream of
CSV exports from bank websites. PDF exports come from the phone's banking
app, so the natural v0.2 import path is the phone share sheet, and the
upload flow gets designed mobile-first at that point. Not a v0.1 change; the
frontend skill's desktop-first line gets revisited in the v0.2 plan.

## 8. Process routing

This document is intake for the next plan iteration: backlog entry plus,
where the plan-writer sees genuinely comparable options, decision records.
Per the binding rule, handing the example PDFs to an implementer does not by
itself put PDF parsing in scope; this addendum is what does.
