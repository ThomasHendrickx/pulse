// Expected failures are values, unexpected failures are exceptions
// (pulse-typescript section 5). Error types are unions of tagged objects
// carrying the data needed to render a message, never English sentences:
// the UI translates them into three languages.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const err = <E>(error: E): { ok: false; error: E } => ({
  ok: false,
  error,
});

export const assertNever = (x: never): never => {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
};
