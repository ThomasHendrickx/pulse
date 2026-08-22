// Counterparty normalisation, BEFORE any matching (pulse-domain section 7,
// pulse-v1-architecture.md:193): uppercase, strip payment terminal noise,
// strip city and date fragments, collapse whitespace. Half of what looks
// like a matching problem is dirty strings that normalise to the same
// thing, so every rule pattern is stored in normalised form and every
// lookup normalises first: one function, both sides.
//
// THE COUNTERPARTY SOURCE RULE LIVES HERE TOO (M3-P6, decision D-11): which
// TEXT a transaction resolves under is one decision, and counterpartyText
// below is its single definition. It used to be written out twice, once in
// the ledger's interpret-window and once in the merchants review builder,
// and two copies of one rule is one rule that can drift. Both call sites
// now import this one.
//
// TWO SIBLING RECIPES DELIBERATELY KEEP THEIR OWN COPIES and must never be
// pulled in here (hazard H6.1): the import module's dedup hash
// (src/modules/import/domain/dedup.ts, a FROZEN recipe whose every input
// is part of a stored key) and the ledger's refund key
// (src/modules/ledger/domain/corrections.ts, which must not change flow
// classifications). Their sameness today is a coincidence of value, not a
// shared decision; unifying them would couple a display-grouping change to
// stored dedup keys and to flow.
//
// A THIRD SIBLING EXISTS AND IS NAMED HERE RATHER THAN LEFT TO BE FOUND,
// because it is written in a language a search for the TypeScript
// expression cannot see: the overview module's reads implement the SAME
// fallback in SQL, and that SQL copy is the one the MONTH VIEW's grouping
// actually reads. Those queries are deliberately raw SQL (pulse-domain
// section 9: the overview aggregations are set-based work Prisma is weak
// at), so they cannot call the helper below.
//
// UPDATED IN FIX ROUND 1 (findings HZ-M3P6-05 and CR-M3P6-02). This comment
// used to say the rule was written twice over there and that naming it was
// all this phase would do, which left the obligation resting on a reader
// noticing a comment. The two occurrences are now hoisted into ONE exported
// fragment, COUNTERPARTY_TEXT_SQL in
// src/modules/overview/adapters/overview-repository.ts, and a second pin in
// test/domain/merchant-review.test.ts reads that file and asserts the SQL
// form appears exactly once and that both reads use it. So the rule has ONE
// definition per language and BOTH are pinned. IF THIS RULE EVER CHANGES,
// change that fragment with it; a grep for the TypeScript expression will
// still not find it, which is why the second pin exists.
//
// SCOPE OF THIS KEY, stated so the next reader does not widen it by
// accident: this key exists for merchant GROUPING only. The ledger's
// refund correction keys on its own counterpartyKey (ledger module,
// corrections.ts) and deliberately does NOT use this normaliser: swapping
// it in would change flow classifications, and resolution must rename and
// regroup, never reclassify (hazard H3.2; M1-P3 open question C9 hands
// that swap to an explicit decision).
//
// STABILITY CONTRACT (fix round 1, finding CR-402; the sibling contract
// is dedup.ts's frozen hash recipe, one module over): MerchantRule
// patterns are stored as THIS PIPELINE'S OUTPUT. assignMerchant writes
// normaliseCounterparty(text) as the EXACT rule subject, and matching
// compares stored patterns against freshly normalised strings, so any
// change to this pipeline (a city token, a noise pattern, a date shape,
// an ordering change) silently detaches whichever stored rules no longer
// reproduce: the executed construction in the M1-P4 hazard verdict shows
// a stored "STARBUCKS OXFORD" naming ceasing to match the moment OXFORD
// joins CITY_TOKENS. The affected rows regress to visible unresolved
// groups (totals do not move), which is still a user decision silently
// ceasing to apply. Therefore ANY change to this file's output MUST ship,
// in the same change, EITHER a one-off re-normalisation of stored
// MerchantRule patterns (EXACT and PREFIX; the pipeline is idempotent
// over its own output, so re-normalising stored patterns is safe) OR an
// explicit recorded decision to version the recipe instead. The pinned
// regression table in test/domain/normalise-counterparty.test.ts exists
// to make an accidental change RED: if it reddens and you meant the
// change, update the pins and bring the migration with you.
//
// M3-P6 DISCHARGED THAT CONTRACT AS FOLLOWS. The card-descriptor patterns
// below changed this file's output for card rows. The deployed database
// was measured before the change (read-only count over the pulse project's
// merchant_rules table) and held ZERO rule rows, so no stored pattern
// existed to detach and no re-normalisation migration was needed; the
// measurement, the command and the branch it selected are recorded in
// delivery/work-history/m3-p6.yaml. The pinned table was updated in the
// same commit. The NEXT change to this file inherits the same obligation
// and the count may no longer be zero.
//
// MASKING IS NOT DONE HERE, AND MUST NEVER BE (hazard H6.4, decision
// D-12): the card number is masked in the DISPLAY layer only
// (src/platform/ui/mask-card-number.ts). This function's output is the
// grouping KEY and the EXACT MerchantRule pattern that assignMerchant
// stores (application/assign-merchant.ts), so a masked key would produce a
// stored rule that can never match a second transaction.

// THE COUNTERPARTY SOURCE RULE, decision D-11, one definition. The named
// counterparty when the export carries one, the description otherwise
// (card rows carry no counterparty account, which is exactly why their
// descriptors need the grammar below). Structural parameter on purpose:
// both call sites pass different row types.
export const counterpartyText = (row: {
  readonly description: string;
  readonly counterpartyName?: string;
}): string => row.counterpartyName ?? row.description;

// THE CARD-DESCRIPTOR GRAMMAR (M3-P6). A card payment has no counterparty
// account, so the merchant key is the WHOLE descriptor, and a Belgian card
// descriptor embeds the transaction's own date, its own amount, the card
// number and the holder name. Measured through the shipped pipeline on the
// owner's real statement: 15 card rows produced 15 distinct keys, so
// naming a merchant wrote an EXACT rule that could never match a second
// transaction. The patterns below remove exactly the per-transaction
// values and the rail vocabulary, and nothing else.
//
// THREE RULES BIND EVERY PATTERN HERE, each bought by a review finding.
//
// 1. NEVER KEY ON DIGIT-RUN LENGTH ALONE. Structured payment references in
//    the same statement are 13 to 19 digits long, exactly the card-number
//    window: measured, 5 non-card keys in one real statement fall inside
//    it. A pattern that strips "a long run of digits" eats those
//    references. Every pattern here is anchored to the card-number LABEL
//    grammar instead.
// 2. NEVER ANCHOR THE PARTIALLY MASKED TAIL ON AN X-MASKED TOKEN, OR ON
//    THE HOLDER TEXT, ALONE (finding PR4-002, PR5-003). Measured on the
//    same statement: 11 descriptors carry an X-masked token, the
//    card-number label occurs in 0 of them, and holder-like text follows
//    the token in 8 of the 11. An X-anchored or holder-anchored pattern
//    fires on rows that are not card rows.
// 3. ANCHOR THE COUNTRY MARKER TO THE ANGLE-BRACKET SHAPE, never to
//    bracketing in general (finding PR3-003): the parenthesised value-date
//    token on every Belfius transaction start line is bracketed too and the
//    template depends on it.
//
// Adding a shape here is a RECIPE CHANGE under the stability contract
// above, so it travels with the stored-pattern re-normalisation. Pin the
// observed shapes and fail closed on anything else rather than widening a
// pattern to cover a shape nobody has seen (tuition mechanism
// "deciding what another program will do by pattern-matching", whose rule
// is the same one tier down: PIN the accepted shapes, never widen).

// The rail names itself in the FIRST token of a card descriptor, optionally
// followed by the wallet the card was presented through. ANCHORED AT THE
// START so it can never eat a hyphenated word out of the middle of a
// merchant name, and the rail names are PINNED, not a wildcard.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (clause R-087, fix round 1,
// finding HZ-M3P6-03). This pattern used to open with an unpinned [A-Z]+
// wildcard for the rail token, which contradicted rule 1 above in the same
// file and was not a theoretical widening: BETALING and AANKOOP are
// ordinary Dutch nouns, and the review demonstrated a NEW collapse, two
// distinct descriptors becoming one key because one of them opened with an
// unrelated capitalised word hyphenated to AANKOOP. Both lists below are
// DATA, the same way CITY_TOKENS is; adding a rail or a wallet is a recipe
// change under the stability contract above.
const CARD_RAIL_PREFIX =
  /^(?:DEBITMASTERCARD-BETALING|BANCONTACT-AANKOOP)\b(?:\s+VIA\s+(?:GOOGLE|APPLE|SAMSUNG|GARMIN|FITBIT)\s+PAY\b)?(?:\s*-)?/;

// The card-number tail, in BOTH shapes the real statement prints (finding
// PR3-002), plus the holder name that follows it. The anchor is the
// card-number LABEL ("KAART", optionally followed by the number word),
// never the digits and never the X tokens: rule 2 above. The number itself
// is four groups of four, separated or not, digits or X-masked, which is
// how a card number is printed rather than how long it is. The holder tail
// is only consumed when it runs to the END of the descriptor, which is the
// only place it has ever been observed, so no merchant name can be eaten
// from the middle.
// The LABEL is captured so the same pattern can serve two purposes: the
// strip replaces the whole match with a space, and the non-destructive floor
// at the bottom of this file replaces it with the label alone, which is what
// keeps a card number out of a stored rule pattern when a descriptor strips
// to nothing (finding HZ-M3P6-02). The separator between groups is [\s.-]*
// rather than [\s.-]? so a double separator cannot slip a card number past
// the pattern (finding CR-M3P6-04).
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
// SIBLING: src/platform/ui/mask-card-number.ts
const CARD_NUMBER_LABEL =
  "(?:KAART(?:\\s+NR\\.?)?|(?:CARTE|CARD)\\s+(?:N\u00b0|NO|NR)\\.?)";

const CARD_NUMBER_TAIL = new RegExp(
  `(\\b${CARD_NUMBER_LABEL})\\s+(?:[0-9X]{4}[\\s.-]*){3}[0-9X]{4}(?:\\s*-\\s*[A-Z][A-Z'-]+(?:\\s+[A-Z][A-Z'-]+)*\\s*$)?`,
  "g",
);

// The same grammar without the global flag, used only as a PREDICATE: does
// this descriptor carry a card-number tail at all? Three behaviours below
// are scoped to card descriptors rather than applied to every string, and a
// separate object keeps lastIndex out of the question.
const CARD_TAIL_PREDICATE = new RegExp(CARD_NUMBER_TAIL.source);

// The country marker Belfius emits as real text inside a descriptor.
// ANGLE brackets specifically (rule 3), one to three letters.
const ANGLE_COUNTRY_MARKER = /\s*<[A-Z]{1,3}>\s*/g;

// The transaction's OWN amount followed by its currency code, in the
// position the card grammar puts it: between the merchant span and the
// card-number label. Keyed on the amount-plus-currency grammar, never on a
// run of digits.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (clause R-087, fix round 1,
// finding HZ-M3P6-04). This pattern used to be GLOBAL while its comment
// called it the transaction's own amount: it stripped an amount plus
// currency anywhere in any descriptor, card row or not, and it was one of
// only two reasons a NON-card key moved at the previous head. It also
// required dot thousands separators, so on the space-grouped thousands form
// it consumed only the tail of the number and left a residue that reads as
// a much smaller number. Both are fixed here: the match must be followed by
// the card-number label, must begin at a field boundary, and accepts either
// thousands form.
const CARD_AMOUNT_BEFORE_LABEL = new RegExp(
  // The lookahead ends with a NEGATIVE letter check rather than a word
  // boundary: the French number word ends in a non-word character, and a
  // trailing \b after one of those never matches, which silently left the
  // amount in a French card key. The letter check refuses "KAARTEN" the way
  // the boundary did and accepts "N\u00b0 " the way the boundary did not.
  `(?:^|\\s)\\d{1,3}(?:[.\\s]\\d{3})*,\\d{2}\\s+(?:EUR|USD|GBP|CHF)(?=\\s+${CARD_NUMBER_LABEL}(?![A-Z]))`,
  "g",
);

// Payment terminal noise: rail vocabulary and card fragments that say HOW
// something was paid, never WHO was paid. Most entries are grounded in the
// committed fixtures (belfius descriptions, kbc card FX rows, the
// card-descriptor fixture), which reproduce the owner's real statement
// formats; the two that are NOT are marked as such at the entry, because a
// blanket grounding claim over a list is the kind of sentence that goes
// false one entry at a time. Extending
// the list when a new export shows a new shape is expected AND is a recipe
// change under the stability contract above, so it travels with the stored
// pattern re-normalisation. Keep every entry a word-bounded pattern so no
// merchant name can be eaten from the middle of a word.
const TERMINAL_NOISE_PATTERNS: readonly RegExp[] = [
  // "BETALING MET DEBETKAART", "BETALING MET KBC-DEBETKAART", kredietkaart.
  /\bBETALING MET (?:[A-Z]+-)?(?:DEBET|KREDIET)?KAART\b/g,
  /\b(?:VIA )?BANCONTACT\b/g,
  /\bMAESTRO\b/g,
  // BOTH SPELLINGS, and which one is grounded where is stated rather than
  // implied (clause R-087, fix round 1, finding HZ-M3P6-06). The DUTCH form
  // is what the real statements and four committed fixtures print, including
  // the card-descriptor fixture this phase added; it was missing, and its
  // absence split two real merchants across the two payment rails. The
  // ENGLISH form is carried for other exports and is grounded in this file's
  // own pinned table only, NOT in any fixture: the comment above this list
  // used to claim fixture grounding for the whole list, which was false for
  // this entry.
  /\bCONTACTLOOS\b/g,
  /\bCONTACTLESS\b/g,
  // Masked card numbers: "XXXX 1234", "****1234".
  /(?:X{4,}|\*{4,})\s?\d{2,6}\b/g,
  // Foreign-amount conversion tails on card rows: "USD 25.00 KOERS 0,9210".
  /\b[A-Z]{3} \d+(?:[.,]\d+)? KOERS \d+(?:[.,]\d+)?\b/g,
];

// Date fragments: purchase dates and times embedded in descriptors make
// every visit to the same shop a distinct string. The BARE day-and-month
// shape (no year) is the one card descriptors carry, and it is matched
// with real day and month ranges so it cannot eat "24/7" or a slice of a
// longer number.
const DATE_FRAGMENT_PATTERNS: readonly RegExp[] = [
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  /\b(?:0[1-9]|[12]\d|3[01])[-/.](?:0[1-9]|1[0-2])\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
];

// City fragments, two shapes:
//   1. A postal code plus city ("9000 GENT"), safe to strip anywhere.
//   2. A bare TRAILING city token ("STARBUCKS ANTWERPEN"). Trailing only,
//      because a city inside a merchant's own name ("BRUSSEL BROODJES BV")
//      is the name. The token list is DATA, not logic: Belgian cities
//      observed or likely in Belgian exports plus the foreign cities the
//      committed card fixture carries. A city missing from the list only
//      means the rule pattern includes it AT WRITE TIME: grouping stays
//      deterministic, and adding the city later detaches that stored
//      pattern, which is exactly the stability contract's case (finding
//      CR-402). Growing this list is a recipe change: re-normalise
//      stored rule patterns in the same change.
// The POSTAL CODE only: the city token it introduces is kept, and the
// trailing-city loop below is what removes a city when a city is the last
// thing left. Removing the pair wholesale is what made the two payment
// rails disagree, because one rail prints "postcode CITY" and the other
// prints the city as bare text, so the same merchant produced two keys
// (finding HZ-M3P6-06). For a trailing postal-city pair the outcome is
// unchanged: the loop takes the city a moment later.
//
// A FOUR-DIGIT GROUP THAT FOLLOWS ANOTHER FOUR-DIGIT GROUP IS NOT A POSTAL
// CODE, and the lookbehind that says so is what makes this pipeline CLOSED
// over its own output (fix round 2, finding CR-M3P6-06). Without it, an
// IBAN inside a descriptor ends in a group followed by the counterparty's
// name, which reads exactly like a postal code followed by a city: the pass
// eats one group, and the NEXT pass eats the one now exposed, so the key
// erodes a group at a time and normalise(key) is not key. That is not
// cosmetic. assign-merchant.ts:54 normalises the submitted subject AGAIN
// before storing it as the EXACT rule pattern, and merchant-rule.ts:68
// compares that pattern to a freshly normalised row, so a key that is not a
// fixed point becomes a rule that matches NOTHING while assignMerchant
// returns ok and every total stays right. That is hazard H6.4.
//
// MEASURED on the owner's own statement, rows whose key is not a fixed
// point: 8 of 39 at the phase base, 8 at the round-0 head, 10 after fix
// round 1 introduced this pattern, and 0 with the lookbehind. The base's own
// 8 are the same family, reached by the base pattern eating the group AND
// the counterparty name behind it; the lookbehind closes those too.
//
// THE LOOKBEHIND WAS WIDER THAN THIS SENTENCE AND IS NOW EXACTLY IT (clause
// R-087, findings CR-M3P6-12 and HZ-M3P6-13). It read (?<!\d ), which
// refused the strip whenever ANY digit and a space preceded the candidate,
// so a house number before a genuine postal code suppressed the strip and
// left the postal code in the key. The sentence above was the rule that was
// intended; the guard is now that rule, (?<!\d{4} ), and the house-number
// shape is pinned in the regression table so the two can never drift apart
// again. Closure is unaffected: still 0 of 39 on the real file and 0 of 19
// over the closure corpus.
const POSTAL_CODE_BEFORE_CITY = /(?<!\d{4} )\b[1-9]\d{3} (?=[A-Z][A-Z'-]+\b)/g;

const CITY_TOKENS: ReadonlySet<string> = new Set([
  "AALST",
  "ANTWERPEN",
  "BRUGGE",
  "BRUSSEL",
  "BRUSSELS",
  "CHARLEROI",
  "GENK",
  "GENT",
  "HALLE",
  "HASSELT",
  "KORTRIJK",
  "LEUVEN",
  "LIEGE",
  "LONDON",
  "LUIK",
  "MECHELEN",
  "NAMEN",
  "NAMUR",
  "OOSTENDE",
  "ROESELARE",
  "SEATTLE",
  "TURNHOUT",
]);

const collapseWhitespace = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

// Separator hygiene, the same class of artifact as a doubled space: a
// strip that removes a field from between two separators leaves the
// separators orphaned. This collapses a RUN of dash separators to one and
// can never touch a letter, so it is not a strip and cannot over-strip.
const collapseOrphanSeparators = (text: string): string =>
  text.replace(/(\s-)(?:\s-)+(?=\s)/g, "$1");

const stripTrailingCityTokens = (text: string): string => {
  const tokens = text.split(" ");
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last === undefined || !CITY_TOKENS.has(last)) {
      break;
    }
    tokens.pop();
  }
  return tokens.join(" ");
};

// The separator dashes a card descriptor prints between its fields. Removed
// as WHOLE TOKENS, so nothing inside a word can be touched, and only on a
// card descriptor: one rail separates every field with a dash and the other
// separates none, which is the second half of why the same merchant
// produced two keys on the two rails (finding HZ-M3P6-06).
const dropSeparatorTokens = (text: string): string =>
  text
    .split(" ")
    .filter((token) => token !== "-")
    .join(" ");

// The strip pipeline, over an already uppercased and collapsed string. It
// may return the EMPTY string; deciding what to do about that is the
// floor's job in normaliseCounterparty below, which is also the only caller
// that runs it twice.
const stripPipeline = (uppercased: string): string => {
  // Three behaviours below are scoped to a descriptor the CARD GRAMMAR
  // matched, decided once here from the text as the bank printed it, before
  // any pattern has moved a token.
  const isCardDescriptor = CARD_TAIL_PREDICATE.test(uppercased);
  let text = uppercased;
  // The card grammar runs FIRST: the rail prefix is anchored at the start
  // of the descriptor and the card tail is anchored at its end, so both
  // read the descriptor as the bank printed it. The amount comes before the
  // tail because its anchor is a LOOKAHEAD at the card-number label, which
  // the tail strip is about to remove.
  text = text.replace(CARD_RAIL_PREFIX, " ");
  text = text.replace(CARD_AMOUNT_BEFORE_LABEL, " ");
  text = text.replace(CARD_NUMBER_TAIL, " ");
  text = text.replace(ANGLE_COUNTRY_MARKER, " ");
  for (const pattern of TERMINAL_NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  for (const pattern of DATE_FRAGMENT_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  text = text.replace(POSTAL_CODE_BEFORE_CITY, "");
  text = collapseWhitespace(text);
  text = isCardDescriptor
    ? collapseWhitespace(dropSeparatorTokens(text))
    : collapseOrphanSeparators(text);
  // THE TRAILING-CITY LOOP RUNS ON EVERY DESCRIPTOR, card or not, and that
  // is a decision this fix round made with a measurement rather than a
  // default (fix round 1, finding HZ-M3P6-08).
  //
  // The finding is real: removing the card tail leaves the city as the final
  // token on one of the two rails, so two branches of one chain in two
  // cities, printed WITHOUT the country marker, now merge where they did not
  // before. That merge is the rule M1-P4 pinned deliberately for every other
  // descriptor ("the same shop seen from two branches normalises
  // identically"), reaching card rows for the first time; it is not a new
  // class of error, and no real card row reaches it because every one of
  // them carries the country marker after the city.
  //
  // THE FIX THE REVIEW PROPOSED WAS IMPLEMENTED HERE AND THEN REJECTED ON
  // EVIDENCE. Skipping this loop for a card descriptor makes the key space
  // NOT CLOSED under the pipeline: a card key ending in a city
  // re-normalises to that key WITHOUT the city, because the second pass sees
  // no card tail and takes the city. The pinned idempotency assertion in
  // test/domain/normalise-counterparty.test.ts went red on exactly that,
  // and the consequence is worse than the finding: assign-merchant.ts
  // normalises the submitted subject again, so the stored EXACT rule would
  // have been the city-less string while every matching row keys with the
  // city, and the owner's naming would have matched NOTHING. That is hazard
  // H6.4, which outranks a latent merge of two branches of one chain.
  text = stripTrailingCityTokens(text);
  return collapseWhitespace(text.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, ""));
};

export const normaliseCounterparty = (rawText: string): string => {
  const uppercased = collapseWhitespace(rawText.toUpperCase());
  const stripped = stripPipeline(uppercased);
  if (stripped !== "") {
    return stripped;
  }
  // NON-DESTRUCTIVE FLOOR: a counterparty whose text is ALL noise must not
  // normalise to the empty string, because an empty key would group
  // unrelated rows together.
  //
  // THE FLOOR IS NOT THE RAW INPUT (fix round 1, finding HZ-M3P6-02). It
  // used to be, and for a card descriptor that put the FULL card number into
  // the grouping key and therefore into the EXACT MerchantRule pattern
  // assign-merchant.ts stores, where no masking reaches and where it would
  // sit until the owner deleted the rule.
  //
  // The floor is the input with the card-number TAIL replaced by its LABEL,
  // put back through the same pipeline. Running the pipeline again is what
  // keeps the floor a FIXED POINT: the stability contract above tells the
  // next implementer that re-normalising a stored pattern is safe because
  // the pipeline is idempotent over its own output, and a floor that
  // returned a string the pipeline would strip further would have made that
  // sentence false for exactly the rows that reach it. No real row has ever
  // reached this line (measured: 0 of 39 rows of the owner's own statement),
  // which is why it is a floor and not a path.
  const withoutCardNumber = collapseWhitespace(
    uppercased.replace(CARD_NUMBER_TAIL, "$1"),
  );
  const flooredAndStripped = stripPipeline(withoutCardNumber);
  if (flooredAndStripped !== "") {
    return flooredAndStripped;
  }
  return withoutCardNumber === "" ? uppercased : withoutCardNumber;
};
