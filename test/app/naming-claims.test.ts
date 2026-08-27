import { describe, expect, it } from "vitest";
import {
  claimNaming,
  createNamingClaimStore,
  forgetNaming,
  recordNaming,
  NAMING_CLAIM_WINDOW_MS,
} from "@/modules/merchants/ui/naming-claims";

// THE TWO-ROWS-IN-FLIGHT PIN (M3-P11 fix round, finding HZ-M3P11-02).
//
// The naming submit's busy state is FORM-WIDE, not screen-wide
// (src/platform/ui/submit-button.tsx reads useFormStatus, which reports the
// nearest ancestor form), so nothing stops a reader naming a second row
// while the first is still in flight. The record that carries the server's
// answer back to the reader therefore has to survive a sibling row's
// naming and a sibling row's failure. Before this fix it was one shared
// slot claimed by whichever row matched first, so a second naming ERASED
// the first row's pending difference and a failure on one row cleared
// another row's claim.
//
// These are the rules, and each one is a sentence about what the reader is
// told, not about the data structure.

const NOW = 1_800_000_000_000;

describe("the naming claim record", () => {
  it("tells the FIRST row its answer differed even after a second row is named", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: "  Bakkerij  ",
      at: NOW,
    });
    recordNaming(store, {
      rowKey: "descriptor:ROW B",
      direction: "spend",
      typed: "Slager",
      at: NOW + 10,
    });
    // Row A's answer comes back trimmed: the reader must still be told.
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("differs");
  });

  it("tells the FIRST row its answer differed even after the second row FAILS", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: "  Bakkerij  ",
      at: NOW,
    });
    recordNaming(store, {
      rowKey: "descriptor:ROW B",
      direction: "spend",
      typed: "Slager",
      at: NOW + 10,
    });
    // Row B's naming is refused, so row B's claim goes and row A's stays.
    forgetNaming(store, "descriptor:ROW B", "spend");
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("differs");
  });

  // THE SAME KEY IN TWO DIRECTIONS (round two, finding HZ2-M3P11-01). The
  // review groups each direction separately over the same counterparty
  // identity, so a counterparty with a spend row and a refund renders TWO
  // rows carrying the SAME data-group-key, which is the identity the leaf
  // writes and retires a claim by. These two cases use one key and two
  // directions on purpose: the pair below with two distinct keys passes
  // against a store keyed on the row alone, so it encodes the assumption
  // rather than testing it.
  it("keeps the income row's claim when the SAME key is named in the other direction", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ONE COUNTERPARTY",
      direction: "income",
      typed: "  Terugbetaling  ",
      at: NOW,
    });
    recordNaming(store, {
      rowKey: "descriptor:ONE COUNTERPARTY",
      direction: "spend",
      typed: "Winkel",
      at: NOW + 10,
    });
    expect(
      claimNaming(store, {
        direction: "income",
        label: "Terugbetaling",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("differs");
  });

  it("keeps the income row's claim when the SAME key FAILS in the other direction", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ONE COUNTERPARTY",
      direction: "income",
      typed: "  Terugbetaling  ",
      at: NOW,
    });
    recordNaming(store, {
      rowKey: "descriptor:ONE COUNTERPARTY",
      direction: "spend",
      typed: "Winkel",
      at: NOW + 10,
    });
    forgetNaming(store, "descriptor:ONE COUNTERPARTY", "spend");
    expect(
      claimNaming(store, {
        direction: "income",
        label: "Terugbetaling",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("differs");
  });

  it("does not raise a notice on a row in the OTHER direction section", () => {
    // One merchant with rows on both sides renders two rows carrying the
    // same label, and the income section renders first, so a claim matched
    // on the label alone lands on a row the reader never named.
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: "  Bakkerij  ",
      at: NOW,
    });
    expect(
      claimNaming(store, {
        direction: "income",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("none");
    // ... and the claim is still there for the row that was actually named.
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("differs");
  });

  it("compares what the SCREEN shows with what the screen would show for the typed name", () => {
    // The row's label is rendered through the card-number masking, so a
    // comparison against the raw typed string is a comparison of two
    // different alphabets (finding HZ-M3P11-03). The rendering function is
    // injected, so this rule is exercised without importing the masker.
    const store = createNamingClaimStore();
    const render = (value: string) => value.replace(/\d{13,19}/g, "MASKED");
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: " 4000123456789010 ",
      at: NOW,
    });
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "MASKED",
        resolved: true,
        now: NOW + 500,
        render,
      }),
    ).toBe("differs");
  });

  it("says nothing when the answer equals the prediction, and says it once", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: "Bakkerij",
      at: NOW,
    });
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 500,
      }),
    ).toBe("confirmed");
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + 600,
      }),
    ).toBe("none");
  });

  it("never claims for an unresolved row and never claims a stale record", () => {
    const store = createNamingClaimStore();
    recordNaming(store, {
      rowKey: "descriptor:ROW A",
      direction: "spend",
      typed: "  Bakkerij  ",
      at: NOW,
    });
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: false,
        now: NOW + 500,
      }),
    ).toBe("none");
    expect(
      claimNaming(store, {
        direction: "spend",
        label: "Bakkerij",
        resolved: true,
        now: NOW + NAMING_CLAIM_WINDOW_MS + 1,
      }),
    ).toBe("none");
  });
});
