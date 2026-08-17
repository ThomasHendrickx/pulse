// The Clock port. Domain code never calls `new Date()` directly; it takes a
// Clock so tests can inject a fixed one (architecture section 10:
// determinism needs an injected, fixed clock).

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
