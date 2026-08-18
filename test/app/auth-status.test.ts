import { describe, expect, test } from "vitest";
import { STATUS_KEYS, isKnownStatus } from "../../src/app/(auth)/status-keys";

// Finding CR-006 (M1-P1 hazard review): the status whitelist used the `in`
// operator, which walks the prototype chain, so inherited keys such as
// "constructor" and "toString" passed the guard and STATUS_KEYS[status]
// handed a Function to the translator. The red witness below is the class,
// not the instance: two structurally different prototype keys (a property
// of Object.prototype that is a constructor reference, and one that is a
// plain inherited method) plus the honest unknown value.

describe("auth status whitelist is own-properties only", () => {
  test("rejects prototype-chain keys", () => {
    expect(isKnownStatus("constructor")).toBe(false);
    expect(isKnownStatus("toString")).toBe(false);
    expect(isKnownStatus("hasOwnProperty")).toBe(false);
    expect(isKnownStatus("__proto__")).toBe(false);
  });

  test("rejects unknown plain values", () => {
    expect(isKnownStatus("not-a-status")).toBe(false);
    expect(isKnownStatus("")).toBe(false);
  });

  test("accepts exactly the declared statuses", () => {
    // By name, never by count: enumerate the object's own keys and assert
    // each passes, so adding a status later cannot silently rot this test.
    for (const key of Object.keys(STATUS_KEYS)) {
      expect(isKnownStatus(key)).toBe(true);
    }
  });

  test("every admitted status resolves to a string message key", () => {
    for (const key of Object.keys(STATUS_KEYS)) {
      if (isKnownStatus(key)) {
        expect(typeof STATUS_KEYS[key]).toBe("string");
      }
    }
  });
});
