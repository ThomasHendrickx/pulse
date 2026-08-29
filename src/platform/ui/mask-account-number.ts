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
// WHERE THIS IS APPLIED, CORRECTED LOUDLY RATHER THAN QUIETLY REWRITTEN
// (clause R-087, fix round, findings HZ-M3P13-02 and CR-M3P13-03).
//
// WHAT THIS PARAGRAPH USED TO SAY, and it was false in the direction that
// costs, because a reader trusts a residue note and stops looking:
//
//   "WHERE THIS IS APPLIED. On the merchant review screen: the group label
//    of an account-basis group that carries no counterparty name, the group
//    label of any other unresolved group, and every description on the
//    transaction lines behind a group. RESIDUE, stated rather than left to
//    be found: the month view renders unnormalised counterparty text on its
//    gap rows and its held rows and masks CARD numbers there only, so an
//    account number inside one of those descriptors is still shown in full.
//    That surface belongs to the overview module and is not this phase's to
//    change."
//
// It named ONE remaining surface and there were FOUR, and the one it left
// out is the worst of them: src/modules/import/ui/profile-confirmation.tsx
// renders the import preview, and its counterparty column falls back to the
// counterparty ACCOUNT when a row carries no name, so that column printed an
// account number whole, in a cell of its own, on every import. The comment
// directly above that cell records it as the screen the owner photographed
// when a card number leaked there.
//
// THE ENUMERATION IS NOW DERIVED RATHER THAN WRITTEN DOWN. It is not a list
// in this comment: test/domain/merchant-review.test.ts walks every .tsx
// under src/ with the TypeScript compiler API, collects every leaf JSX
// expression that renders a field from its SENSITIVE_FIELDS vocabulary, and
// asserts that every surface passing through the card mask passes through
// THIS mask too, and that any surface passing through neither is a declared
// exclusion with a reason.
//
// THE VOCABULARY IS THE WALK'S REACH, AND IT WAS TOO NARROW WHEN THIS
// PARAGRAPH FIRST CLAIMED THE WALK AS THE AUTHORITY (round two, finding
// CR2-M3P13-01). It was called DESCRIPTOR_FIELDS and every member was a
// descriptor name, so a surface rendering an ACCOUNT without touching a
// descriptor field was invisible: the accounts list's number cell was
// neither counted nor excluded, and this file's own group.accountAlias was
// seen only because it shares a JSX expression with group.label. The
// vocabulary now carries the account-bearing names too. ANYONE ADDING A
// FIELD THAT CAN HOLD AN IDENTIFIER ADDS ITS NAME THERE, or this comment is
// making a promise the instrument cannot keep. A list here would be a second source and this project has recorded
// three times that a convention between two sources does not survive; the
// falsity above is the fourth.
//
// The nine call sites at the head of this fix round, for orientation only,
// with the derivation above as the authority: the merchant review's group
// label and transaction descriptions, the import preview's counterparty and
// descriptor cells, and the month view's group label, reserves label, held
// rows and gap rows.
//
// WHAT REMAINS UNMASKED, and it is a list of things that are NOT identifiers
// rather than a list of surfaces: the declared exclusions in that test. Each
// is a value the household typed (an account label, a format name) or
// translated copy, and each carries its reason there where it is checked
// rather than here where it is only asserted.

import {
  ACCOUNT_NUMBER_LENGTH_BOUNDS,
  ACCOUNT_NUMBER_LENGTH_BY_COUNTRY,
  accountNumberChecksumHolds,
  canonicalAccountNumber,
  isAccountNumberWhitespace,
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
// separator between them. A run that ends against another letter or digit
// is refused, because a longer token is not that account number. Nothing is
// masked on shape alone and nothing is masked on a guess.
//
// THE SEPARATOR SET, CORRECTED LOUDLY RATHER THAN QUIETLY REWRITTEN (clause
// R-087, fix round, findings HZ-M3P13-01 and CR-M3P13-04). This file used to
// test `character === " "` and carry the comment:
//
//   "Exactly ONE space is tolerated between characters, and only between
//    them: a run may not begin or end on one."
//
// BOTH HALVES WERE WRONG. The loop skips each separator individually with no
// counter, so ANY number of them is tolerated, and the comment said one. And
// the accepted separator was the ASCII space ALONE, while the canonical form
// this same file imports strips the whole /\s/ class, so the tree held two
// answers and the masker FAILED OPEN on the difference: an account grouped
// with U+00A0, U+202F, U+2002, a tab, a newline, a full stop or a hyphen
// broke the run, fell short of the registry length and was COPIED THROUGH IN
// FULL. That is not a hypothetical character. U+00A0 is the single byte 0xA0
// in Windows-1252, one of exactly two encodings the importer accepts
// (src/modules/import/domain/source-profile.ts), and this repository has
// already witnessed it inside stored account renderings (M3-P18 finding
// HZ-M3P18-01, recorded at src/platform/account-number.ts).
//
// The whitespace half is now ASKED of src/platform/account-number.ts rather
// than answered here, so there is exactly one answer; the two punctuation
// separators are the ones the sibling card mask already tolerates
// (src/platform/ui/mask-card-number.ts, the [\s.-]* between its groups).
// test/domain/identity-on-review.test.ts DERIVES the agreement: every
// character canonicalAccountNumber removes must be a separator this mask
// tolerates.
const CANDIDATE_START = /\b[A-Za-z]{2}[^A-Za-z0-9]?[0-9]{2}/g;
const ALPHANUMERIC = /[A-Za-z0-9]/;

// THE ISO 11649 STRUCTURED CREDITOR REFERENCE, EXCLUDED BY NAME (round two,
// finding CR2-M3P13-03). It is literally RF, two check digits and an
// alphanumeric body, and its check is the SAME mod-97 over the same
// rearrangement this file's fallback applies, so every valid RF reference
// whose length falls inside the registry's bounds satisfies both the grammar
// and the arithmetic by construction. Probe-confirmed at lengths 16, 20 and
// 24. It is not a country code, so refusing it costs nothing.
const CREDITOR_REFERENCE_PREFIX = "RF";

// THE SEPARATOR RULE IS CLOSED, NOT ENUMERATED (round two, finding
// HZ2-M3P13-01), and this is the second time it has been widened, so the
// history is kept rather than tidied away.
//
//   ROUND ONE SHIPPED `character === " "`, which failed open on every other
//   separator, U+00A0 included.
//   THE FIX ROUND replaced it with a SET, whitespace plus a full stop and a
//   hyphen, which fixed the members it named and left the rest failing open:
//   measured at that head, the zero-width space U+200B, the word joiner
//   U+2060, the soft hyphen U+00AD, the en dash U+2013, the underscore and
//   the solidus each returned the account fully legible. U+00AD is byte 0xAD
//   in Windows-1252, the same encoding whose byte 0xA0 produced the original
//   defect.
//   THIS ROUND STATES THE RULE AS A CLOSURE: anything that is not a letter
//   or a digit separates. A character nobody has thought of is covered,
//   which a list can never be.
//
// THE BOUND, and it is a DELIBERATE DEVIATION from the fix the finding
// proposed, recorded here because the deviation is the interesting part. The
// finding asked for "any single non-alphanumeric character between run
// characters, bounded to ONE consecutive separator". The closure half is
// taken as written. The bound is NOT, because a flat bound of one would stop
// masking an account written with a DOUBLED SPACE, which the round-one probe
// recorded as masked today, so obeying it literally would trade one
// fail-open for another. What is implemented instead keeps both properties:
// whitespace is unbounded, because a doubled space is a real rendering and
// unmasking it would be a new leak, and AT MOST ONE NON-WHITESPACE separator
// is crossed per gap, which is what stops the scan walking across arbitrary
// punctuation between unrelated tokens. Both directions are pinned in
// test/domain/identity-on-review.test.ts.
//
// THE DERIVED AGREEMENT WITH canonicalAccountNumber IS KEPT, and it still
// earns its place: whitespace is now a subset of what separates here rather
// than the whole of it, so the test asserts a subset relation, which is what
// would catch the canonical form gaining a character this scan somehow did
// not treat as a separator.
//
// KNOWN LIMIT, RECORDED RATHER THAN LEFT TO BE REDISCOVERED (finding
// HZ2-M3P13-01, second shape): an account GLUED to a preceding word with no
// boundary between them is not masked, because CANDIDATE_START anchors on a
// word boundary. Dropping the anchor would make every two-letter,
// two-digit sequence inside every word a candidate. The shape has not been
// observed in any export this project has read.
const isSeparatorCharacter = (character: string): boolean =>
  character !== "" && !ALPHANUMERIC.test(character);

// The index of the next run character after the gap starting at `at`, or
// undefined when the gap is not crossable: more than one non-whitespace
// separator in it, whitespace where the caller does not allow it, or the end
// of the text.
//
// WHY WHITESPACE IS A PARAMETER (round two, finding HZ2-M3P13-02). A space is
// the separator a bank prints BETWEEN THE GROUPS of one account and it is
// also the separator that ends a word, and nothing local tells the two apart.
// The known-country branch can cross it safely because the registry tells it
// how many characters to take, so it stops on its own. The
// unregistered-country branch has no length to stop at, so if it crossed
// spaces its run would reach the end of the sentence. It does not cross them.
const acrossGap = (
  text: string,
  at: number,
  crossWhitespace: boolean,
): number | undefined => {
  let index = at;
  let nonWhitespace = 0;
  while (index < text.length && isSeparatorCharacter(text[index] ?? "")) {
    const whitespace = isAccountNumberWhitespace(text[index] ?? "");
    if (whitespace && !crossWhitespace) {
      return undefined;
    }
    if (!whitespace) {
      nonWhitespace += 1;
      if (nonWhitespace > 1) {
        return undefined;
      }
    }
    index += 1;
  }
  return index < text.length ? index : undefined;
};

const VISIBLE_TAIL = 4;
const COUNTRY_AND_CHECK = 4;
const MASK = "****";

// Consume EXACTLY `expected` letters-or-digits from `from`, crossing gaps by
// the rule above but never beginning or ending on one, and refuse a run that
// ends against another letter or digit.
const runOfLength = (
  text: string,
  from: number,
  expected: number,
  crossWhitespace: boolean,
): { readonly end: number; readonly compact: string } | undefined => {
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
    if (taken === 0 || taken >= expected) {
      break;
    }
    const next = acrossGap(text, at, crossWhitespace);
    if (next === undefined) {
      break;
    }
    at = next;
  }
  if (taken < expected) {
    return undefined;
  }
  if (ALPHANUMERIC.test(text[at] ?? "")) {
    return undefined;
  }
  return { end: at, compact: canonicalAccountNumber(characters.join("")) };
};

// How many letters-or-digits the maximal run starting at `from` holds. THE
// WHOLE TOKEN OR NOTHING (round two, finding HZ2-M3P13-02): the fallback
// asks this ONCE and then asks for exactly that length, so exactly one
// length is ever a candidate.
const maximalRunLength = (text: string, from: number): number => {
  let total = 0;
  let at = from;
  while (at < text.length) {
    if (ALPHANUMERIC.test(text[at] ?? "")) {
      total += 1;
      at += 1;
      continue;
    }
    if (total === 0) {
      break;
    }
    const next = acrossGap(text, at, false);
    if (next === undefined) {
      break;
    }
    at = next;
  }
  return total;
};

// The source span of an account number starting at `from`, or undefined if
// none starts there.
//
// TWO BRANCHES, AND THE SECOND ONE IS THE FAIL-CLOSED HALF (fix round,
// finding HZ-M3P13-04). A country the registry carries takes the fast path:
// the table gives the length and the scan consumes it. A country the
// registry does NOT carry used to be passed through in full, which is the
// same fail-open direction as the separator defect: for the VALIDITY test in
// src/platform/account-number.ts refusing an unknown country is right,
// because the cost of being wrong there is a registration the owner can see
// refused, but here the cost of being wrong is that the value is SHOWN.
//
// CORRECTED IN ROUND TWO, LOUDLY, BECAUSE THE REASON GIVEN WAS FALSE AND THE
// MECHANISM WAS GREEDY (findings CR2-M3P13-03 and HZ2-M3P13-02).
//
//   WHAT THE REASON USED TO SAY: "That is a checksum and not a shape, so it
//   cannot fire on a mandate reference, a card number or a phone number,
//   which is this file's own rule applied to itself." A card number and a
//   phone number are indeed safe, because neither carries two letters
//   followed by two digits at a word boundary. A CREDITOR REFERENCE IS NOT:
//   the ISO 11649 RF family shares this exact checksum by construction, and
//   the lane probe-confirmed valid RF references of length 16, 20 and 24
//   were all redacted. The family is now refused by name above, and the
//   claim is narrowed to what is true.
//
//   WHAT THE MECHANISM USED TO DO: loop from the registry's longest length
//   down to its shortest and take the first run whose checksum held. Because
//   gaps are crossable, several lengths reached a legal end on separated
//   text and each got a one-in-ninety-seven draw, longest first, which is
//   the greediness the header above says this file was rewritten to avoid.
//   Measured over 40,000 constructed reference-shaped descriptors: 2,035
//   masked with no account present, 428 of those with a following word eaten
//   into the mask.
//
//   WHAT IT DOES NOW, AND WHY IT IS NOT LITERALLY THE FIX THAT WAS ASKED
//   FOR. The finding proposed walking to the end of the maximal run and
//   asking for that length once. The single-candidate half is taken and is
//   what removes the one-in-twenty rate. The other half of the claim, that
//   this makes word-swallowing impossible, DOES NOT FOLLOW, and measuring it
//   is how that was established: a space separates the groups of one account
//   AND separates two words, so a maximal run that crosses spaces reaches
//   the end of the sentence, and the single remaining candidate then still
//   swallows every following word on its one-in-ninety-seven draw. So this
//   branch DOES NOT CROSS WHITESPACE AT ALL. Its run ends at the first
//   space, which makes swallowing impossible by construction rather than
//   rare, and leaves exactly one candidate length.
//
//   WHAT THAT COSTS, stated rather than left to be found: an account of a
//   country the registry does not carry, written in SPACE-SEPARATED groups,
//   is not redacted. It is redacted when written compactly or grouped with
//   any non-whitespace separator. HOW BIG THAT COST IS DEPENDS ON A CLAIM
//   THIS FILE DID NOT MEASURE: the round-one hazard review recorded the
//   pinned table as complete against ISO 13616 as published, which would make
//   this branch a safety net for a country that joins later rather than a
//   path with a known member today. That is attributed rather than asserted;
//   test/domain/account-number.test.ts is where the table is pinned, and
//   whoever adds a country there should re-read this paragraph. What IS
//   measured is the other side of the trade: crossing spaces here cost 428
//   eaten words in 40,000 constructed descriptors, on three shipped screens.
const accountSpanAt = (
  text: string,
  from: number,
): { readonly end: number; readonly compact: string } | undefined => {
  const expected = ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.get(
    text.slice(from, from + 2).toUpperCase(),
  );
  if (expected !== undefined) {
    return runOfLength(text, from, expected, true);
  }
  if (
    text.slice(from, from + 2).toUpperCase() === CREDITOR_REFERENCE_PREFIX
  ) {
    return undefined;
  }
  const total = maximalRunLength(text, from);
  if (
    total < ACCOUNT_NUMBER_LENGTH_BOUNDS.shortest ||
    total > ACCOUNT_NUMBER_LENGTH_BOUNDS.longest
  ) {
    return undefined;
  }
  const span = runOfLength(text, from, total, false);
  if (span === undefined || !accountNumberChecksumHolds(span.compact)) {
    return undefined;
  }
  return span;
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
      const compact = span.compact;
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
