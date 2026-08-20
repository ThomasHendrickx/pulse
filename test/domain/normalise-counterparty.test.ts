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
