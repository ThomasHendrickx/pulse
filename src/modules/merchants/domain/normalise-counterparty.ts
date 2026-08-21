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
// expression cannot see: the overview module's grouped read implements the
// SAME fallback in SQL, as COALESCE(t."counterpartyName", t."description"),
// at src/modules/overview/adapters/overview-repository.ts:95 and :266. That
// query is deliberately raw SQL (pulse-domain section 9: the overview
// aggregations are set-based work Prisma is weak at), so it cannot call the
// helper below. IF THIS RULE EVER CHANGES, that COALESCE changes with it,
// and a grep for the TypeScript expression will not find it. M3-P6 left it
// where it is: it agrees with the helper today, and rewriting an
// aggregation query was not this phase's change.
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

// The rail names itself in the FIRST token of a card descriptor:
// "<RAIL>-BETALING" or "<RAIL>-AANKOOP", optionally followed by the wallet
// the card was presented through. ANCHORED AT THE START so it can never
// eat a hyphenated word out of the middle of a merchant name. The wallet
// list is DATA, not logic, the same way CITY_TOKENS is.
const CARD_RAIL_PREFIX =
  /^[A-Z]+-(?:BETALING|AANKOOP)\b(?:\s+VIA\s+(?:GOOGLE|APPLE|SAMSUNG|GARMIN|FITBIT)\s+PAY\b)?(?:\s*-)?/;

// The card-number tail, in BOTH shapes the real statement prints (finding
// PR3-002), plus the holder name that follows it. The anchor is the
// card-number LABEL ("KAART", optionally followed by the number word),
// never the digits and never the X tokens: rule 2 above. The number itself
// is four groups of four, separated or not, digits or X-masked, which is
// how a card number is printed rather than how long it is. The holder tail
// is only consumed when it runs to the END of the descriptor, which is the
// only place it has ever been observed, so no merchant name can be eaten
// from the middle.
const CARD_NUMBER_TAIL =
  /\bKAART(?:\s+NR\.?)?\s+(?:[0-9X]{4}[\s.-]?){3}[0-9X]{4}(?:\s*-\s*[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+)*\s*$)?/g;

// The country marker Belfius emits as real text inside a descriptor.
// ANGLE brackets specifically (rule 3), one to three letters.
const ANGLE_COUNTRY_MARKER = /\s*<[A-Z]{1,3}>\s*/g;

// The transaction's own amount followed by its currency code, Belgian
// decimal form. Keyed on the amount-plus-currency grammar, never on a run
// of digits.
const AMOUNT_CURRENCY_TAIL =
  /\b\d{1,3}(?:\.\d{3})*,\d{2}\s+(?:EUR|USD|GBP|CHF)\b/g;

// Payment terminal noise: rail vocabulary and card fragments that say HOW
// something was paid, never WHO was paid. Grounded in the committed
// fixtures (belfius descriptions, kbc card FX rows, the card-descriptor
// fixture), which reproduce the owner's real statement formats; extending
// the list when a new export shows a new shape is expected AND is a recipe
// change under the stability contract above, so it travels with the stored
// pattern re-normalisation. Keep every entry a word-bounded pattern so no
// merchant name can be eaten from the middle of a word.
const TERMINAL_NOISE_PATTERNS: readonly RegExp[] = [
  // "BETALING MET DEBETKAART", "BETALING MET KBC-DEBETKAART", kredietkaart.
  /\bBETALING MET (?:[A-Z]+-)?(?:DEBET|KREDIET)?KAART\b/g,
  /\b(?:VIA )?BANCONTACT\b/g,
  /\bMAESTRO\b/g,
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
const POSTAL_CITY_PATTERN = /\b[1-9]\d{3} [A-Z][A-Z'-]+\b/g;

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

export const normaliseCounterparty = (rawText: string): string => {
  const uppercased = collapseWhitespace(rawText.toUpperCase());
  let text = uppercased;
  // The card grammar runs FIRST: the rail prefix is anchored at the start
  // of the descriptor and the card tail is anchored at its end, so both
  // read the descriptor as the bank printed it, before any other pattern
  // has moved a token.
  text = text.replace(CARD_RAIL_PREFIX, " ");
  text = text.replace(CARD_NUMBER_TAIL, " ");
  text = text.replace(ANGLE_COUNTRY_MARKER, " ");
  text = text.replace(AMOUNT_CURRENCY_TAIL, " ");
  for (const pattern of TERMINAL_NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  for (const pattern of DATE_FRAGMENT_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  text = text.replace(POSTAL_CITY_PATTERN, " ");
  text = collapseWhitespace(text);
  text = collapseOrphanSeparators(text);
  text = stripTrailingCityTokens(text);
  text = collapseWhitespace(text.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, ""));
  // Non-destructive floor: a counterparty whose text is ALL noise must not
  // normalise to the empty string, because an empty key would group
  // unrelated rows together. Fall back to the collapsed uppercase form.
  return text === "" ? uppercased : text;
};
