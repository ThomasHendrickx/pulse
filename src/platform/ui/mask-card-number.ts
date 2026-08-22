// DISPLAY-ONLY masking of a card number, applied where a descriptor is
// RENDERED and nowhere else (M3-P6, decision D-12, hazards H6.4, H6.6 and
// H6.7). The owner reported an unmasked card number on screen: a card
// descriptor embeds the full number, and both the group label for an
// unresolved counterparty and the import confirmation preview render
// descriptor text.
//
// WHERE THIS IS APPLIED. The enumeration is DERIVED, and the derivation is
// an executable test rather than a sentence: see "every rendering surface
// that shows descriptor text is derived, not remembered" in
// test/domain/merchant-review.test.ts. It walks every .tsx under src/ with
// the TypeScript compiler API, collects every LEAF JSX expression that reads
// a descriptor-derived field, and requires each one to pass through this
// helper or to appear in a declared exclusion table with its reason.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (clause R-087, fix round 2,
// finding CR-M3P6-08). This comment used to carry a single-line grep and
// claim it returned eight sites in three files. It did when it was written
// and it did NOT at the head, because applying the masking split the two
// preview cells across several lines and a line-based grep stopped seeing
// them: the act of using the derivation falsified the record of it. Worse,
// the review constructed the dangerous direction, an UNMASKED multi-line
// cell that the grep could not see at all while the suite stayed green. The
// compiler-API walk sees it, finds NINE leaf sites in FOUR files, and
// reddens on that construction. Five of them mask:
//   - src/modules/import/ui/profile-confirmation.tsx:100 and :101, the
//     confirm-format preview's counterparty and descriptor cells, which
//     render the RAW parsed descriptor. This is the screen the owner
//     photographed.
//   - src/modules/merchants/ui/merchant-review.tsx, the review group label.
//   - src/modules/overview/ui/month-view.tsx, the month-view group label
//     and the reconciliation gap row, which renders the UNNORMALISED
//     counterparty text.
// Four are excluded, each for a stated reason rather than by omission, and
// the reasons live in the test's exclusion table so they are checked rather
// than merely written:
//   - merchant-review.tsx's hidden counterpartyText field, which MUST stay
//     unmasked: it becomes the EXACT MerchantRule pattern (decision D-12).
//   - month-view.tsx's reserves group label, which is the user's own
//     declared account label or a counterparty IBAN, not a descriptor.
//   - month-view.tsx's reconciliation part label, which is translated copy.
//   - the import route's two declared account labels, typed by the
//     household itself and never parsed from a statement line. The grep this
//     comment used to carry never saw that file at all.
//
// WHERE IT MUST NEVER BE APPLIED, each with the damage it would do:
//   - Transaction.rawLine and Import.rawContent (prisma/schema/import.prisma).
//     Those are FACTS and facts are immutable (CLAUDE.md non-negotiable 5).
//     Masking a fact would destroy the M3-P2 re-parse contract, because a
//     profile fix re-parses stored raw lines and would then rebuild rows
//     from text the bank never printed.
//   - Any dedup key input (src/modules/import/domain/dedup.ts, a FROZEN
//     recipe). A changed key turns the next re-upload into a full duplicate
//     import.
//   - The normalised grouping key, and above all the hidden counterpartyText
//     value the merchant review form submits, because that value becomes the
//     EXACT MerchantRule pattern (src/modules/merchants/application/
//     assign-merchant.ts). A masked subject would match nothing, so the
//     owner's naming would silently apply to no transaction at all.
//
// This module is in platform/ui because it knows nothing about a
// transaction: it takes a string and returns a string (pulse-frontend
// section 2's test for platform versus a module).

// CORRECTED RATHER THAN QUIETLY REWRITTEN (clause R-087, fix round 1,
// finding HZ-M3P6-01). This file used to identify a card number by SHAPE
// ALONE, as "13 to 19 digits once spaces, dots and dashes are removed",
// and it carried the sentence:
//
//   "The separator may appear at most ONCE between two digits, so this can
//    never join two distant numbers into one run."
//
// THAT SENTENCE WAS FALSE, and the review falsified it by probe: one space
// is enough, and one space is exactly what separates two adjacent fields
// after whitespace collapse, so two short numeric fields one space apart
// were joined into one "card number" and masked, and four characters were
// eaten out of the digit tail of an alphanumeric merchant token. Measured
// on the owner's two real statements, that helper masked ZERO card numbers
// and SIX non-card identifiers: IBANs, a SEPA mandate reference and a phone
// number, every one of them an identity the owner reads to tell one
// unresolved group from another.
//
// THE MECHANISM, not the instance: identifying a value by the SHAPE it
// happens to have instead of by the GRAMMAR that defines it. The merchants
// normaliser one module over already refuses that, in the rule it states at
// its own patterns, and this helper now obeys the same discipline. A card
// number is masked where the CARD-NUMBER LABEL identifies one, and nowhere
// else. The cost is stated plainly rather than hidden: a card number
// printed with no label is NOT masked by this helper, which is the trade
// that keeps an IBAN, a mandate reference and a phone number intact.

// The card-number tail, the same grammar the merchants normaliser strips
// and anchored the same way: the card-number LABEL, optionally followed by
// the number word, then four groups of four digits or X-masked characters.
// The separator between groups is [\s.-]* rather than [\s.-]? so a double
// separator cannot slip a whole card number past the mask (finding
// CR-M3P6-04), which matters here because this helper reads RAW descriptors
// where nothing has collapsed the whitespace.
// THE CARD-NUMBER LABEL VOCABULARY, in the three languages a Belgian
// export can print it in (fix round 2, finding HZ-M3P6-10). The Dutch form
// is what both real statements print; the French and English forms are
// added because the delimited import path is generic and language-free, and
// Pulse ships French user-facing content, so a French export is a near-term
// shape rather than a hypothetical one.
//
// THIS LINE IS DUPLICATED, DELIBERATELY AND UNDER A PIN. The other copy is
// in the file named below, and the two must stay identical: a label pinned
// in only one of them puts a card number on SCREEN or into a STORED RULE
// depending on which one was missed. test/domain/merchant-review.test.ts
// reads both files and asserts the two lines are byte-identical, the same
// shape as the SQL pin one module over. The two cannot be merged into one
// module: the normaliser is domain code that imports nothing, and the
// masker lives in platform/ui.
//
// NARROWED IN THE FINAL MICRO ROUND (finding HZ-M3P6-12). The alternation
// used to accept the BARE label word in all three languages, so a label word
// standing alone as an ORDINARY NOUN immediately before four four-character
// groups was consumed together with everything after it: a French merchant
// name ending in the everyday idiom that contains the label word lost its
// last three words from the key, and a non-card reference rendered as a
// masked card number. The bare form is now accepted ONLY in Dutch, which is
// the language both real statements print and the only one where the bare
// form is OBSERVED: 8 of 23 real card rows carry it. French and English must
// carry the number word, which is how a card statement prints them and which
// an ordinary noun does not. That is this file's own rule applied to itself:
// pin the accepted shapes, never widen to a shape nobody has seen.
//
// RESIDUE, stated rather than left to be found: the Dutch bare form is still
// reachable by an ordinary Dutch noun standing alone before four groups. It
// cannot be narrowed the same way without dropping a shape 8 real rows use.
// The label word INSIDE a longer word does not fire in any of the three
// languages, which is what the word boundary buys and what the negative pins
// in the regression table hold.
// SIBLING: src/modules/merchants/domain/normalise-counterparty.ts
const CARD_NUMBER_LABEL =
  "(?:KAART(?:\\s+NR\\.?)?|(?:CARTE|CARD)\\s+(?:N\u00b0|NO|NR)\\.?)";

const CARD_NUMBER_TAIL = new RegExp(
  `(\\b${CARD_NUMBER_LABEL}\\s+)((?:[0-9X]{4}[\\s.-]*){3}[0-9X]{4})\\b`,
  "g",
);

const VISIBLE_CHARACTERS = 4;
const MASK = "****";

export const maskCardNumbers = (text: string): string =>
  text.replace(CARD_NUMBER_TAIL, (_match, label: string, number: string) => {
    const compact = number.replace(/[\s.-]/g, "");
    return `${label}${MASK} ${compact.slice(-VISIBLE_CHARACTERS)}`;
  });
