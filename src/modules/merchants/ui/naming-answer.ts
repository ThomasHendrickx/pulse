// THE SHAPE OF THE NAMING ACTION'S ANSWER, and the check that the client
// applies to it before dereferencing anything.
//
// The action's success tail ends in redirect(), which throws, so a
// successful naming reaches the awaiting client wrapper as a rejection
// carrying a NEXT_REDIRECT digest and this type's ok: true arm is
// unreachable today. The client must therefore not assume the shape it
// receives: an answer that does not match is treated as a transport
// failure, which is loud, reverted and true, since the client still does
// not know what the server did.
//
// PURE ON PURPOSE, so the fast gate can hold the rule: the leaf that uses
// it is a client component and the browser gate this phase depends on has
// never been runnable in this project's containers.

export type NamingActionAnswer =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly kind: string } };

export const isNamingActionAnswer = (
  value: unknown,
): value is NamingActionAnswer => {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  const { ok } = value as { readonly ok: unknown };
  if (typeof ok !== "boolean") {
    return false;
  }
  if (ok) {
    return true;
  }
  // THE PAYLOAD, NOT ONLY THE DISCRIMINANT (round two, finding
  // HZ2-M3P11-03). The refusal arm is the one that dereferences: the
  // client looks the wording up by error.kind. A guard that stopped at the
  // boolean let an answer of ok false with no error through and threw the
  // same TypeError inside the transition that this guard was added to
  // prevent, in the same place.
  if (!("error" in value)) {
    return false;
  }
  const { error } = value as { readonly error: unknown };
  if (typeof error !== "object" || error === null || !("kind" in error)) {
    return false;
  }
  const { kind } = error as { readonly kind: unknown };
  return typeof kind === "string";
};
