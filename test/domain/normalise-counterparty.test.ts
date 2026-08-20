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
