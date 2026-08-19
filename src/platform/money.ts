// Money is integer cents, always, as a branded type (pulse-typescript
// section 1). Negative is money leaving the pot, positive is money
// entering. Conversion to a display string happens only in the rendering
// layer, through the shared formatter in platform/ui.

import type { Brand } from "./tenancy";

export type Cents = Brand<number, "Cents">;

export const cents = (n: number): Cents => {
  if (!Number.isInteger(n)) {
    throw new Error(`Amount must be integer cents, got ${n}`);
  }
  return n as Cents;
};
