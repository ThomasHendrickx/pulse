// The Clock port. Domain code never calls `new Date()` directly; it takes a
// Clock so tests can inject a fixed one (architecture section 10:
// determinism needs an injected, fixed clock).

import { fixedNowOverride } from "./config";

export type Clock = {
  readonly now: () => Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

// Fixed clock for tests and seeds. Returns a fresh Date each call so a
// caller mutating the result cannot corrupt later reads.
export const fixedClock = (at: Date): Clock => ({
  now: () => new Date(at.getTime()),
});

// The clock composition roots bind: the system clock, unless the
// deterministic-environment override is set (PULSE_FIXED_NOW, parsed in
// platform/config.ts, set by the Playwright webServer and nothing else).
export const appClock = (): Clock => {
  const fixed = fixedNowOverride();
  return fixed === undefined ? systemClock : fixedClock(fixed);
};
