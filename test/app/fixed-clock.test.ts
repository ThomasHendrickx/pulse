import { afterEach, describe, expect, test } from "vitest";
import { fixedNowOverride } from "@/platform/config";
import { appClock } from "@/platform/clock";

// Fix round 1, CR-503: the deterministic-clock override must be REFUSED
// in production. The review's executed probe showed NODE_ENV=production
// honouring PULSE_FIXED_NOW silently, freezing the month view's notion
// of the current month with no log line; the config module's own
// comment claimed the variable was unset everywhere else, unchecked.
// These tests pin the refusal and the dev behaviour.

// Next's ambient types mark NODE_ENV readonly; tests legitimately vary
// it, so writes go through a mutable view of the same object.
const env = process.env as Record<string, string | undefined>;
const setEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
};

const savedNodeEnv = process.env.NODE_ENV;
const savedOverride = process.env.PULSE_FIXED_NOW;

afterEach(() => {
  setEnv("NODE_ENV", savedNodeEnv);
  setEnv("PULSE_FIXED_NOW", savedOverride);
});

describe("PULSE_FIXED_NOW", () => {
  test("is refused loudly in production", () => {
    setEnv("NODE_ENV", "production");
    setEnv("PULSE_FIXED_NOW", "2020-01-01T00:00:00Z");
    expect(() => fixedNowOverride()).toThrow(/production/);
    expect(() => appClock().now()).toThrow(/production/);
  });

  test("absent in production, the system clock runs", () => {
    setEnv("NODE_ENV", "production");
    setEnv("PULSE_FIXED_NOW", undefined);
    expect(fixedNowOverride()).toBeUndefined();
    const now = appClock().now().getTime();
    expect(Math.abs(now - Date.now())).toBeLessThan(5_000);
  });

  test("outside production the override pins the clock", () => {
    setEnv("NODE_ENV", "development");
    setEnv("PULSE_FIXED_NOW", "2026-09-15T12:00:00Z");
    expect(appClock().now().toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  test("a set-but-invalid value throws instead of silently running the real clock", () => {
    setEnv("NODE_ENV", "development");
    setEnv("PULSE_FIXED_NOW", "not-an-instant");
    expect(() => fixedNowOverride()).toThrow(/valid instant/);
  });
});
