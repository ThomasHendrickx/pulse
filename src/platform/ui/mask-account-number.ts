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

import { ACCOUNT_NUMBER_LENGTH_BY_COUNTRY } from "@/platform/account-number";

// The candidate shape, deliberately WIDER than what is masked: two letters,
// two digits, then at least eight further letters or digits, written
// compact or in groups separated by a single space. Every match is then put
// through the registry test below, and a match that fails it is returned
// untouched. Widening the candidate costs nothing because the test is what
// decides; narrowing the TEST is what would cost an owner their privacy.
const ACCOUNT_CANDIDATE = /\b[A-Za-z]{2}[0-9]{2}(?:[ ]?[A-Za-z0-9]){8,32}\b/g;

const VISIBLE_TAIL = 4;
const COUNTRY_AND_CHECK = 4;
const MASK = "****";

export const maskAccountNumbers = (text: string): string =>
  text.replace(ACCOUNT_CANDIDATE, (match) => {
    const compact = match.replace(/\s/g, "").toUpperCase();
    const expected = ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.get(compact.slice(0, 2));
    if (expected === undefined || expected !== compact.length) {
      return match;
    }
    return `${compact.slice(0, COUNTRY_AND_CHECK)} ${MASK} ${compact.slice(
      -VISIBLE_TAIL,
    )}`;
  });
