// DISPLAY-ONLY masking of a counterparty account number, applied where an
// account or a descriptor carrying one is RENDERED and nowhere else
// (M3-P13, decision D-41, hazards H13.1 and H13.2). The sibling of
// mask-card-number.ts, and it obeys the same three rules, which are stated
// there in full and repeated here only in their conclusion:
//
//   IDENTIFY BY GRAMMAR, NEVER BY SHAPE ALONE. A token is masked when it
//   carries a country code the pinned registry knows AND the exact length
//   that registry assigns that country. A run of digits that merely looks
//   long enough is not an account number and is left alone, which is what
//   keeps a mandate reference, a card number and a phone number intact.
//
//   NEVER ON A KEY. The counterparty IDENTITY KEY, the stored MerchantRule
//   pattern and the hidden field the naming form submits stay UNMASKED: a
//   masked subject would produce a rule that can never match a second
//   transaction, which is exactly hazard H13.1 and the same hazard
//   src/modules/merchants/domain/normalise-counterparty.ts states for card
//   numbers.
//
//   NEVER ON A FACT. Transaction.rawLine, Transaction.description and
//   Import.rawContent are facts and facts are immutable (CLAUDE.md
//   non-negotiable 5). This helper takes a string and returns a string; it
//   is the RENDERING that calls it.
//
// MECHANISM RULE, RECORDED AT THE DEFINITION (clause mechanism-sibling).
// The mechanism is REDACTING AN IDENTIFIER OUT OF TEXT THAT IS ABOUT TO BE
// SHOWN. Its rule: redact on the identifier's GRAMMAR, never on its shape,
// and never let the redacted value reach a key, a dedup input or a stored
// pattern. THE SIBLING IMPLEMENTATIONS in this tree are
// src/platform/ui/mask-card-number.ts (the card-number tail) and
// src/modules/merchants/domain/normalise-counterparty.ts (the descriptor
// normaliser, which strips rather than masks and states the same rule one
// tier down). The rule is not local to this file.
//
// WHERE THIS IS APPLIED. On the merchant review screen: the group label of
// an account-basis group that carries no counterparty name, the group
// label of any other unresolved group (whose descriptor can carry an
// account token of its own), and every description on the transaction
// lines behind a group. RESIDUE, stated rather than left to be found: the
// month view renders unnormalised counterparty text on its gap rows and
// its held rows and masks CARD numbers there only, so an account number
// inside one of those descriptors is still shown in full. That surface
// belongs to the overview module and is not this phase's to change; it is
// recorded here so the next reader of this file meets it.

import {
  ACCOUNT_NUMBER_LENGTH_BY_COUNTRY,
  canonicalAccountNumber,
} from "@/platform/account-number";

// THE SCAN IS LENGTH-DIRECTED, NOT GREEDY, and that is the whole design.
// A greedy pattern followed by a validity test does not work here: in
// "OVERSCHRIJVING NAAR BE78 2222 3333 4444 DEMO VERZEKERING" a greedy
// group-shaped pattern swallows DEMO as a fifth group, the compacted match
// is then the wrong length, the test refuses it and the account is printed
// in full. Measured on exactly that string before this was rewritten.
//
// So the registry decides the length BEFORE any consuming happens: a
// candidate begins at a word boundary with two letters and two digits, the
// registry says how many characters that country's account numbers have,
// and the scan consumes EXACTLY that many letters-or-digits, tolerating a
// single space between them. A run that ends against another letter or
// digit is refused, because a longer token is not that account number.
// Nothing is masked on shape alone and nothing is masked on a guess.
const CANDIDATE_START = /\b[A-Za-z]{2}[0-9]{2}/g;
const ALPHANUMERIC = /[A-Za-z0-9]/;

const VISIBLE_TAIL = 4;
const COUNTRY_AND_CHECK = 4;
const MASK = "****";

// The source span of an account number starting at `from`, or undefined if
// no account number of a known country and its registry length starts
// there.
const accountSpanAt = (
  text: string,
  from: number,
): { readonly end: number; readonly compact: string } | undefined => {
  const expected = ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.get(
    text.slice(from, from + 2).toUpperCase(),
  );
  if (expected === undefined) {
    return undefined;
  }
  let taken = 0;
  let at = from;
  const characters: string[] = [];
  while (taken < expected && at < text.length) {
    const character = text[at] ?? "";
    if (ALPHANUMERIC.test(character)) {
      characters.push(character);
      taken += 1;
      at += 1;
      continue;
    }
    // Exactly ONE space is tolerated between characters, and only between
    // them: a run may not begin or end on one.
    if (character === " " && taken > 0 && taken < expected) {
      at += 1;
      continue;
    }
    break;
  }
  if (taken < expected) {
    return undefined;
  }
  if (ALPHANUMERIC.test(text[at] ?? "")) {
    return undefined;
  }
  return { end: at, compact: characters.join("").toUpperCase() };
};

export const maskAccountNumbers = (text: string): string => {
  CANDIDATE_START.lastIndex = 0;
  let out = "";
  let copiedTo = 0;
  let match = CANDIDATE_START.exec(text);
  while (match !== null) {
    const from = match.index;
    if (from < copiedTo) {
      match = CANDIDATE_START.exec(text);
      continue;
    }
    const span = accountSpanAt(text, from);
    if (span !== undefined) {
      // THE CANONICAL FORM IS PLATFORM'S, NOT A SECOND COPY OF IT (M3-P14
      // criterion 14.4, pinned by test/domain/account-number.test.ts: a
      // third whitespace-removal in the tree is red). This helper decides
      // what to SHOW; it does not decide what an account number is.
      const compact = canonicalAccountNumber(span.compact);
      out += text.slice(copiedTo, from);
      out += `${compact.slice(0, COUNTRY_AND_CHECK)} ${MASK} ${compact.slice(
        -VISIBLE_TAIL,
      )}`;
      copiedTo = span.end;
      CANDIDATE_START.lastIndex = span.end;
    }
    match = CANDIDATE_START.exec(text);
  }
  return out + text.slice(copiedTo);
};
