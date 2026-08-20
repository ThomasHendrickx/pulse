// Counterparty normalisation, BEFORE any matching (pulse-domain section 7,
// pulse-v1-architecture.md:193): uppercase, strip payment terminal noise,
// strip city and date fragments, collapse whitespace. Half of what looks
// like a matching problem is dirty strings that normalise to the same
// thing, so every rule pattern is stored in normalised form and every
// lookup normalises first: one function, both sides.
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

// Payment terminal noise: rail vocabulary and card fragments that say HOW
// something was paid, never WHO was paid. Grounded in the committed
// fixtures (belfius descriptions, kbc card FX rows), which reproduce the
// owner's two real statement formats; extending the list when a new
// export shows a new shape is expected AND is a recipe change under the
// stability contract above, so it travels with the stored-pattern
// re-normalisation. Keep every entry a word-bounded pattern so no
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
// every visit to the same shop a distinct string.
const DATE_FRAGMENT_PATTERNS: readonly RegExp[] = [
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
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
  for (const pattern of TERMINAL_NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  for (const pattern of DATE_FRAGMENT_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  text = text.replace(POSTAL_CITY_PATTERN, " ");
  text = collapseWhitespace(text);
  text = stripTrailingCityTokens(text);
  text = collapseWhitespace(text.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, ""));
  // Non-destructive floor: a counterparty whose text is ALL noise must not
  // normalise to the empty string, because an empty key would group
  // unrelated rows together. Fall back to the collapsed uppercase form.
  return text === "" ? uppercased : text;
};
