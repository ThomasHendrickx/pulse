import { describe, expect, it } from "vitest";
import { isNamingActionAnswer } from "@/modules/merchants/ui/naming-answer";

// M3-P11 round two, finding HZ2-M3P11-03. The guard exists so that an
// answer the client does not recognise degrades to the loud failure notice
// instead of throwing inside a transition, where the reader meets an error
// boundary rather than a sentence. It has to cover the PAYLOAD the refusal
// arm dereferences, not only the discriminant it switches on.

describe("the naming answer guard", () => {
  it("refuses the shapes that carry no answer at all", () => {
    expect(isNamingActionAnswer(undefined)).toBe(false);
    expect(isNamingActionAnswer(null)).toBe(false);
    expect(isNamingActionAnswer({})).toBe(false);
    expect(isNamingActionAnswer("ok")).toBe(false);
  });

  it("accepts a success and a refusal that carries its kind", () => {
    expect(isNamingActionAnswer({ ok: true })).toBe(true);
    expect(
      isNamingActionAnswer({ ok: false, error: { kind: "empty-counterparty" } }),
    ).toBe(true);
  });

  it("refuses a refusal whose payload is missing or malformed", () => {
    // This is the shape the finding walked: it passed a guard that checked
    // the discriminant only, reached the lookup of the refusal wording by
    // kind, and threw the exact TypeError the guard was added to prevent.
    expect(isNamingActionAnswer({ ok: false })).toBe(false);
    expect(isNamingActionAnswer({ ok: false, error: null })).toBe(false);
    expect(isNamingActionAnswer({ ok: false, error: {} })).toBe(false);
    expect(isNamingActionAnswer({ ok: false, error: { kind: 7 } })).toBe(false);
  });
});
