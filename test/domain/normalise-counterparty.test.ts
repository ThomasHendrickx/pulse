import { describe, expect, test } from "vitest";
import { normaliseCounterparty } from "../../src/modules/merchants/domain/normalise-counterparty";

// Criterion 3.1: normalisation before any matching (pulse-domain section 7,
// pulse-v1-architecture.md:193): uppercase, strip payment terminal noise,
// strip city and date fragments, collapse whitespace. Half of what looks
// like a hard matching problem is dirty strings that normalise to the same
// thing. The noise shapes below are grounded in the committed fixtures
// (belfius-account-a.csv descriptions, kbc-card.csv FX rows), which
// themselves reproduce the owner's two real statement formats.

describe("uppercase", () => {
  test("lowercase and mixed-case input normalise to uppercase", () => {
    expect(normaliseCounterparty("Supermarkt Noord")).toBe("SUPERMARKT NOORD");
    expect(normaliseCounterparty("acme salaris bv")).toBe("ACME SALARIS BV");
  });

  test("two casings of the same counterparty normalise identically", () => {
    expect(normaliseCounterparty("Café Zomer")).toBe(
      normaliseCounterparty("CAFÉ ZOMER"),
    );
  });
});

describe("payment terminal noise", () => {
  test("the card-payment prefix is stripped", () => {
    expect(
      normaliseCounterparty("BETALING MET DEBETKAART SUPERMARKT NOORD GENT"),
    ).toBe("SUPERMARKT NOORD");
  });

  test("a bank-branded card prefix is stripped too", () => {
    expect(
      normaliseCounterparty("BETALING MET KBC-DEBETKAART VIA BANCONTACT SUPERMARKT NOORD"),
    ).toBe("SUPERMARKT NOORD");
  });

  test("rail names and masked card numbers are stripped", () => {
    expect(normaliseCounterparty("MAESTRO XXXX 1234 SUPERMARKT NOORD")).toBe(
      "SUPERMARKT NOORD",
    );
    expect(normaliseCounterparty("CONTACTLESS SUPERMARKT NOORD")).toBe(
      "SUPERMARKT NOORD",
    );
  });

  test("a foreign-currency conversion tail is stripped (kbc card FX row)", () => {
    expect(
      normaliseCounterparty("AMAZON US SEATTLE USD 25.00 KOERS 0,9210"),
    ).toBe("AMAZON US");
  });
});

describe("date fragments", () => {
  test("slashed, dashed and dotted dates are stripped", () => {
    expect(normaliseCounterparty("SUPERMARKT NOORD 12/08/2026")).toBe(
      "SUPERMARKT NOORD",
    );
    expect(normaliseCounterparty("SUPERMARKT NOORD 12-08-2026")).toBe(
      "SUPERMARKT NOORD",
    );
    expect(normaliseCounterparty("SUPERMARKT NOORD 12.08.26")).toBe(
      "SUPERMARKT NOORD",
    );
  });

  test("a time-of-day fragment is stripped with the date", () => {
    expect(normaliseCounterparty("SUPERMARKT NOORD 12/08/2026 14:35")).toBe(
      "SUPERMARKT NOORD",
    );
  });

  test("two rows differing only in the purchase date normalise identically", () => {
    expect(normaliseCounterparty("SUPERMARKT NOORD 05/08/2026")).toBe(
      normaliseCounterparty("SUPERMARKT NOORD 28/08/2026"),
    );
  });
});

describe("city fragments", () => {
  test("a trailing city token is stripped", () => {
    expect(normaliseCounterparty("STARBUCKS ANTWERPEN")).toBe("STARBUCKS");
    expect(normaliseCounterparty("PIZZA NAPOLI BRUSSEL")).toBe("PIZZA NAPOLI");
  });

  test("a postal code plus city tail is stripped wherever it sits", () => {
    expect(normaliseCounterparty("SUPERMARKT NOORD 9000 GENT")).toBe(
      "SUPERMARKT NOORD",
    );
  });

  test("the same shop seen from two branches normalises identically", () => {
    expect(normaliseCounterparty("SUPERMARKT NOORD GENT")).toBe(
      normaliseCounterparty("SUPERMARKT NOORD ANTWERPEN"),
    );
  });

  test("a city NAME inside the merchant name survives: only trailing tokens strip", () => {
    expect(normaliseCounterparty("BRUSSEL BROODJES BV")).toBe(
      "BRUSSEL BROODJES BV",
    );
  });
});

describe("whitespace collapse", () => {
  test("runs of spaces, tabs and stray whitespace collapse to single spaces", () => {
    expect(normaliseCounterparty("  SUPERMARKT   NOORD \t GENT ")).toBe(
      "SUPERMARKT NOORD",
    );
  });

  test("noise stripping never leaves doubled spaces behind", () => {
    expect(
      normaliseCounterparty("SUPERMARKT 12/08/2026 NOORD"),
    ).toBe("SUPERMARKT NOORD");
  });
});

describe("the recipe's output is pinned: stored rule patterns depend on it (finding CR-402)", () => {
  // STABILITY REGRESSION TABLE. MerchantRule patterns are stored as this
  // pipeline's output (see the stability contract at the top of
  // normalise-counterparty.ts), so an output change silently detaches
  // stored manual namings: the hazard verdict's executed construction
  // shows a stored "STARBUCKS OXFORD" rule ceasing to match once OXFORD
  // joins the city list. This table pins the EXACT output for a
  // representative input per pipeline stage plus the fixture-shaped
  // composites, so any accidental recipe change reddens here. If this
  // test reddens and the change is INTENDED: update the pins AND ship the
  // stored-pattern re-normalisation (or the recorded versioning decision)
  // in the same change; that obligation is the point of the pin.
  //
  // M3-P6 DID EXACTLY THAT. The card-descriptor pins below were added in
  // the same commit as the recipe change that produced them, and the
  // contract's other half was discharged by measuring the deployed
  // database first: it held ZERO MerchantRule rows, so no stored pattern
  // could detach and no re-normalisation migration was owed. The
  // measurement and the command are in delivery/work-history/m3-p6.yaml.
  // NOTE FOR THE NEXT CHANGE: none of the pre-M3-P6 pins moved, which is
  // evidence that the card patterns are additive over the earlier corpus,
  // NOT evidence that the next recipe change will be.
  const PINNED: readonly (readonly [string, string])[] = [
    // Plain names: uppercase plus collapse only.
    ["Supermarkt Noord", "SUPERMARKT NOORD"],
    ["Acme Salaris BV", "ACME SALARIS BV"],
    ["Caf\u00e9 Zomer", "CAF\u00c9 ZOMER"],
    // Terminal noise, each pattern family once.
    ["BETALING MET DEBETKAART SUPERMARKT NOORD GENT", "SUPERMARKT NOORD"],
    ["BETALING MET KBC-DEBETKAART VIA BANCONTACT SUPERMARKT NOORD", "SUPERMARKT NOORD"],
    ["MAESTRO XXXX 1234 SUPERMARKT NOORD", "SUPERMARKT NOORD"],
    ["CONTACTLESS SUPERMARKT NOORD", "SUPERMARKT NOORD"],
    ["AMAZON US SEATTLE USD 25.00 KOERS 0,9210", "AMAZON US"],
    // Date and time fragments.
    ["SUPERMARKT NOORD 12/08/2026", "SUPERMARKT NOORD"],
    ["SUPERMARKT NOORD 12.08.26 14:35", "SUPERMARKT NOORD"],
    // City fragments: postal pair, trailing token, non-trailing kept.
    ["SUPERMARKT NOORD 9000 GENT", "SUPERMARKT NOORD"],
    ["STARBUCKS ANTWERPEN", "STARBUCKS"],
    ["PIZZA NAPOLI BRUSSEL", "PIZZA NAPOLI"],
    ["BRUSSEL BROODJES BV", "BRUSSEL BROODJES BV"],
    // A city NOT in the token list stays in the key (today's recipe;
    // adding it later is the exact detachment case the contract names).
    ["STARBUCKS OXFORD", "STARBUCKS OXFORD"],
    // Whitespace collapse and the all-noise fallback.
    ["  SUPERMARKT   NOORD \t GENT ", "SUPERMARKT NOORD"],
    ["GENT", "GENT"],
    ["12/08/2026", "12/08/2026"],
    // M3-P6, the card-descriptor grammar. Every input below is SYNTHETIC,
    // invented values in the real grammar, and each one pins a different
    // pattern family: the two printed card-tail shapes, the separator
    // variants of the number, the second payment rail with its
    // angle-bracket country marker, and the two rows the strip must NOT
    // touch. These pins are what makes an accidental widening of the card
    // patterns red.
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 04/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "KOFFIEHUIS DE MOLEN GENT BE",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 18/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART 4000 12XX XXXX 9010 - JANSSENS PIETER",
      "KOFFIEHUIS DE MOLEN GENT BE",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 15/08 TANKSTATION DE BRUG GENT BE 62,00 EUR KAART NR 4000-1234-5678-9010 - JANSSENS PIETER",
      "TANKSTATION DE BRUG GENT BE",
    ],
    // FIX ROUND 1. The two payment rails now agree: the same merchant in the
    // same city produces the SAME key whether it was paid on the contactless
    // rail or the wallet rail (finding HZ-M3P6-06). Before the round these
    // two pinned to different strings, which split two real merchants in the
    // owner's statement into two groups each.
    [
      "BANCONTACT-AANKOOP - BAKKERIJ ZONNEBLOEM <B> - 9000 GENT BE - 12/08/26 14:35 - CONTACTLOOS - KAART 4000 12XX XXXX 9010 - JANSSENS PIETER",
      "BAKKERIJ ZONNEBLOEM GENT BE",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 25/08 BAKKERIJ ZONNEBLOEM GENT BE 3,60 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "BAKKERIJ ZONNEBLOEM GENT BE",
    ],
    // FIX ROUND 1, finding HZ-M3P6-03: the rail prefix is a PINNED
    // alternation, so an ordinary capitalised word hyphenated to a Dutch
    // noun keeps its place in the key and two such descriptors stay two.
    ["GROEPS-AANKOOP SAMENTUIN VZW LIDGELD", "GROEPS-AANKOOP SAMENTUIN VZW LIDGELD"],
    ["SAMENTUIN VZW LIDGELD", "SAMENTUIN VZW LIDGELD"],
    // FIX ROUND 1, finding HZ-M3P6-08, PINNED AS THE BEHAVIOUR IT IS rather
    // than as the behaviour the finding asked for. A card descriptor whose
    // CITY is the final token, with no country marker after it, reaches the
    // trailing-city loop once the card tail is gone, so two branches of one
    // chain in two cities merge. That is M1-P4's deliberate rule (the same
    // shop seen from two branches normalises identically) reaching card rows
    // for the first time. Skipping the loop for card descriptors was
    // implemented and rejected: it breaks the idempotency the CR-402
    // contract rests on and produces a stored rule that matches nothing. See
    // the comment at the loop in normalise-counterparty.ts.
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 26/08 FIETSPUNT DE KETTING GENT 24,00 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "FIETSPUNT DE KETTING",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 27/08 FIETSPUNT DE KETTING ANTWERPEN 26,00 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "FIETSPUNT DE KETTING",
    ],
    // FIX ROUND 1, finding HZ-M3P6-02: a card descriptor with no merchant
    // span strips to nothing and reaches the non-destructive floor. The
    // floor carries the card-number LABEL and never the number.
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 28/08 KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "KAART NR",
    ],
    // FIX ROUND 1, finding HZ-M3P6-04: the amount strip is scoped to the
    // card grammar and reads BOTH thousands forms. The space-grouped form
    // used to leave a truncated number behind.
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 29/08 MEUBELHUIS DE EIK GENT BE 1 250,00 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "MEUBELHUIS DE EIK GENT BE",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 30/08 MEUBELHUIS DE EIK GENT BE 1.250,00 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "MEUBELHUIS DE EIK GENT BE",
    ],
    // ... and an amount on a NON-card row is NOT the transaction's own
    // amount and is left alone.
    ["ABONNEMENT 1.234,56 EUR SPORTCLUB NOORD", "ABONNEMENT 1.234,56 EUR SPORTCLUB NOORD"],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 06/08 SUPERMARKT DE LINDE NOORD GENT BE 21,40 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "SUPERMARKT DE LINDE NOORD GENT BE",
    ],
    [
      "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 07/08 SUPERMARKT DE LINDE ZUID GENT BE 18,75 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
      "SUPERMARKT DE LINDE ZUID GENT BE",
    ],
    // The two rows the card patterns must leave alone: a legitimate
    // 13-to-19-digit structured reference, and an X-masked token followed
    // by holder-like text with NO card-number label.
    [
      "OVERSCHRIJVING NAAR ENERGIE NOORD BV MEDEDELING 415123456789012",
      "OVERSCHRIJVING NAAR ENERGIE NOORD BV MEDEDELING 415123456789012",
    ],
    [
      "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX XXXX 9010 - JANSSENS PIETER",
      "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX - JANSSENS PIETER",
    ],
  ];

  test.each(PINNED)("%j stays pinned to %j", (input, pinned) => {
    expect(normaliseCounterparty(input)).toBe(pinned);
  });

  test("the pipeline is idempotent over its own output, so re-normalising stored patterns is safe", () => {
    for (const [, pinned] of PINNED) {
      expect(normaliseCounterparty(pinned)).toBe(pinned);
    }
  });
});

describe("degenerate inputs stay non-destructive", () => {
  test("a string that is ALL noise falls back to its collapsed uppercase form instead of vanishing", () => {
    // A counterparty must never normalise to the empty string while the
    // raw text had content: an empty key would silently group unrelated
    // rows together.
    expect(normaliseCounterparty("GENT")).toBe("GENT");
    expect(normaliseCounterparty("12/08/2026")).toBe("12/08/2026");
  });

  test("the empty string stays empty", () => {
    expect(normaliseCounterparty("")).toBe("");
    expect(normaliseCounterparty("   ")).toBe("");
  });

  test("normalisation is idempotent", () => {
    const once = normaliseCounterparty("BETALING MET DEBETKAART Café Zomer GENT 04/08/2026");
    expect(normaliseCounterparty(once)).toBe(once);
  });
});

// M3-P6. The card-descriptor grammar. Every string below is SYNTHETIC,
// invented values in the real grammar, and every one of them also appears
// in the committed fixture test/fixtures/card-descriptors.csv, so the unit
// assertions and the fixture the grouping and import tests run on cannot
// drift apart. Nothing from any real statement is reproduced here.
//
// The invented card number is 4000 1234 5678 9010 and the invented holder
// is JANSSENS PIETER.

const CARD_AUG_FULL =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 04/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER";
const CARD_AUG_FULL_OTHER_DAY =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 11/08 KOFFIEHUIS DE MOLEN GENT BE 3,80 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER";
const CARD_SEP_FULL =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 02/09 KOFFIEHUIS DE MOLEN GENT BE 5,10 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER";
const CARD_AUG_MASKED =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 18/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART 4000 12XX XXXX 9010 - JANSSENS PIETER";
const CARD_SEP_MASKED =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 09/09 KOFFIEHUIS DE MOLEN GENT BE 6,00 EUR KAART 4000 12XX XXXX 9010 - JANSSENS PIETER";
const CARD_DASHED_NUMBER =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 15/08 TANKSTATION DE BRUG GENT BE 62,00 EUR KAART NR 4000-1234-5678-9010 - JANSSENS PIETER";
const CARD_SECOND_RAIL =
  "BANCONTACT-AANKOOP - BAKKERIJ ZONNEBLOEM <B> - 9000 GENT BE - 12/08/26 14:35 - CONTACTLOOS - KAART 4000 12XX XXXX 9010 - JANSSENS PIETER";
const CARD_SECOND_RAIL_OTHER_DAY =
  "BANCONTACT-AANKOOP - BAKKERIJ ZONNEBLOEM <B> - 9000 GENT BE - 03/09/26 08:12 - CONTACTLOOS - KAART 4000 12XX XXXX 9010 - JANSSENS PIETER";
const CHAIN_NOORD =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 06/08 SUPERMARKT DE LINDE NOORD GENT BE 21,40 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER";
const CHAIN_ZUID =
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 07/08 SUPERMARKT DE LINDE ZUID GENT BE 18,75 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER";
const LONG_STRUCTURED_REFERENCE =
  "OVERSCHRIJVING NAAR ENERGIE NOORD BV MEDEDELING 415123456789012";
// The control: an X-masked token followed by holder-like text and NO
// card-number label. Measured on the real statement, 8 of the 11 X-token
// descriptors have exactly this shape, so a masked-tail pattern anchored on
// the X token or on the holder text alone fires here and is wrong.
const NON_CARD_X_TOKEN_CONTROL =
  "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX XXXX 9010 - JANSSENS PIETER";
// The value this control normalised to BEFORE the M3-P6 recipe change,
// captured by running the base recipe at 68fc7ee. The strip must leave it
// exactly here.
const NON_CARD_X_TOKEN_CONTROL_PRE_CHANGE_KEY =
  "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX - JANSSENS PIETER";

// A card-number run is 13 to 19 digits once spaces, dots and dashes are
// removed. It is NOT a contiguous 16-digit regex: the real statement prints
// the number grouped four by four and the extractor's gap rule inserts the
// spaces, so a contiguous-digits test matches nothing and can never fail
// (finding PR3-001; measured on the real statement, contiguous 16-digit
// runs in the parsed descriptors: 0, separator-insensitive runs: every card
// row).
const cardNumberRuns = (text: string): readonly string[] =>
  text.replace(/[ .\-]/g, "").match(/(?<!\d)\d{13,19}(?!\d)/g) ?? [];

describe("card descriptor grammar: the per-transaction values come out, the merchant stays (M3-P6)", () => {
  test("two card rows of one merchant differing only in date and amount normalise identically", () => {
    expect(normaliseCounterparty(CARD_AUG_FULL)).toBe(
      normaliseCounterparty(CARD_AUG_FULL_OTHER_DAY),
    );
  });

  test("rows of one merchant in two DIFFERENT MONTHS normalise identically", () => {
    expect(normaliseCounterparty(CARD_AUG_FULL)).toBe(
      normaliseCounterparty(CARD_SEP_FULL),
    );
  });

  test("the full grouped tail and the partially masked tail of one merchant normalise identically", () => {
    expect(normaliseCounterparty(CARD_AUG_FULL)).toBe(
      normaliseCounterparty(CARD_AUG_MASKED),
    );
    expect(normaliseCounterparty(CARD_SEP_MASKED)).toBe(
      normaliseCounterparty(CARD_AUG_FULL),
    );
  });

  test("the merchant survives the strip", () => {
    expect(normaliseCounterparty(CARD_AUG_FULL)).toContain(
      "KOFFIEHUIS DE MOLEN",
    );
  });

  test("a dash-separated card number is stripped like a space-separated one", () => {
    expect(cardNumberRuns(normaliseCounterparty(CARD_DASHED_NUMBER))).toEqual(
      [],
    );
    expect(normaliseCounterparty(CARD_DASHED_NUMBER)).toContain(
      "TANKSTATION DE BRUG",
    );
  });

  test("the second payment rail's prefix and its angle-bracket country marker are stripped", () => {
    const key = normaliseCounterparty(CARD_SECOND_RAIL);
    expect(key).toContain("BAKKERIJ ZONNEBLOEM");
    expect(key).not.toContain("BANCONTACT");
    expect(key).not.toContain("AANKOOP");
    expect(key).not.toContain("<B>");
    expect(cardNumberRuns(key)).toEqual([]);
  });

  test("two rows of one merchant on the second rail normalise identically", () => {
    expect(normaliseCounterparty(CARD_SECOND_RAIL)).toBe(
      normaliseCounterparty(CARD_SECOND_RAIL_OTHER_DAY),
    );
  });

  test("no card key retains the invented card number, in any of its printed shapes", () => {
    for (const descriptor of [
      CARD_AUG_FULL,
      CARD_AUG_MASKED,
      CARD_SEP_FULL,
      CARD_SEP_MASKED,
      CARD_DASHED_NUMBER,
      CARD_SECOND_RAIL,
      CHAIN_NOORD,
      CHAIN_ZUID,
    ]) {
      const key = normaliseCounterparty(descriptor);
      expect(key.replace(/[ .\-]/g, "")).not.toContain("4000123456789010");
      expect(cardNumberRuns(key)).toEqual([]);
      expect(key).not.toContain("JANSSENS");
      expect(key).not.toContain("KAART");
    }
  });
});

describe("the strip is anchored to the card-tail grammar, not to digits, X tokens or holder text (M3-P6)", () => {
  test("a legitimate 13-to-19-digit structured reference on a NON-card row survives in the key", () => {
    const key = normaliseCounterparty(LONG_STRUCTURED_REFERENCE);
    expect(key).toContain("415123456789012");
    expect(cardNumberRuns(key)).toEqual(["415123456789012"]);
  });

  test("a non-card row carrying an X-masked token followed by holder-like text is UNCHANGED by the strip", () => {
    expect(normaliseCounterparty(NON_CARD_X_TOKEN_CONTROL)).toBe(
      NON_CARD_X_TOKEN_CONTROL_PRE_CHANGE_KEY,
    );
  });

  test("two merchants sharing a chain prefix AND a city stay two distinct keys", () => {
    const noord = normaliseCounterparty(CHAIN_NOORD);
    const zuid = normaliseCounterparty(CHAIN_ZUID);
    expect(noord).not.toBe(zuid);
    expect(noord).toContain("NOORD");
    expect(zuid).toContain("ZUID");
  });

  test("bracketing in general is NOT a country marker: a parenthesised value-date token survives", () => {
    // The Belfius template depends on the parenthesised value-date token on
    // every transaction start line (finding PR3-003), so the marker pattern
    // is anchored to the ANGLE-bracket shape only.
    expect(normaliseCounterparty("PIZZA NAPOLI (VAL. 12-08-2026) BON")).toContain(
      "(VAL.",
    );
  });

  test("the rail prefix is anchored at the START: a hyphenated word inside a name survives", () => {
    expect(normaliseCounterparty("TRAITEUR MEUBEL-BETALING SERVICE")).toBe(
      "TRAITEUR MEUBEL-BETALING SERVICE",
    );
  });

  test("the holder tail is consumed only at the END: a dashed suffix without a card tail survives", () => {
    expect(normaliseCounterparty("BROODJESZAAK DE HOEK - FILIAAL NOORD")).toBe(
      "BROODJESZAAK DE HOEK - FILIAAL NOORD",
    );
  });

  test("the bare day-and-month strip cannot eat a slice of a longer number", () => {
    expect(normaliseCounterparty("REFERENTIE 1234-5678")).toBe(
      "REFERENTIE 1234-5678",
    );
  });

  test("normalisation of a card descriptor stays idempotent", () => {
    const once = normaliseCounterparty(CARD_AUG_FULL);
    expect(normaliseCounterparty(once)).toBe(once);
  });
});
