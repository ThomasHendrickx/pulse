// Flow is the field the whole overview hangs on (pulse-domain section 3).
// Five values, a union, never a string. UNRESOLVED is shown, never dropped
// or defaulted into a total (charter constraint).

export type Flow = "INCOME" | "SPEND" | "INTERNAL" | "RESERVE" | "UNRESOLVED";

export const FLOW_VALUES: readonly Flow[] = [
  "INCOME",
  "SPEND",
  "INTERNAL",
  "RESERVE",
  "UNRESOLVED",
];
