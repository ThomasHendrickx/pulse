// THE NAMING CLAIM RECORD (M3-P11). A successful naming redirects and
// refreshes the review, which unmounts the predicting row (its key leaves
// the projection) and renders the server's answer in a DIFFERENT row, so
// no single component instance ever sees both the typed and the stored
// name. This module is the bridge between the two renders.
//
// IT IS A PURE MODULE ON PURPOSE, imported by the client leaf and by the
// fast gate alike: the rules below are the ones criterion 11.5 turns on,
// and a rule that can only be exercised through a browser is a rule this
// container cannot witness at all.
//
// THE RULES, AND WHY EACH ONE EXISTS (fix round, finding HZ-M3P11-02). The
// first version of this mechanism was ONE SHARED SLOT matched on the label
// alone, and three things followed that the reader would have paid for.
// The naming submit's busy state is FORM-WIDE, not screen-wide, because
// useFormStatus reports the nearest ancestor form only, so a reader can
// name a second row while the first is still in flight; the second naming
// then OVERWROTE the first row's record and a failure on the second row
// CLEARED it, in both cases leaving the first row's difference untold. And
// a merchant with groups on both sides renders two rows carrying the same
// label, income first, so a claim matched on the label alone raised the
// notice on a row the reader never named.
//
// So: one entry PER SUBMITTING ROW, additive, and a claim that must agree
// on the DIRECTION as well as the label. Within one direction a resolved
// group is one row per merchant and merchant names are unique per
// household, so direction plus label identifies the answering row exactly.
//
// WHAT THIS STILL CANNOT DO, stated rather than left to be found. The row
// that answers is not the row that submitted: naming changes a group's key
// from the counterparty identity to the merchant id, and the review
// projection carries no link from a merchant back to the key that was
// named. Building one is a change to the merchants domain and projection,
// which criterion 11.8 pins to an empty diff, so the match stays on
// direction plus label. If a later phase widens the projection, this
// lookup should key on the submitted identity instead and the two-rows
// pin in test/app/naming-claims.test.ts is what will keep it honest.

export type NamingDirection = "income" | "spend";

export type NamingClaim = {
  readonly rowKey: string;
  readonly direction: NamingDirection;
  readonly typed: string;
  readonly at: number;
};

export type ClaimOutcome = "none" | "confirmed" | "differs";

// A record nobody claimed within this window is stale and is dropped, so a
// much later unrelated mount cannot claim it.
export const NAMING_CLAIM_WINDOW_MS = 30_000;

export type NamingClaimStore = { entries: NamingClaim[] };

export const createNamingClaimStore = (): NamingClaimStore => ({ entries: [] });

// WHICH ROW AN ENTRY BELONGS TO, and it is the PAIR (round two, finding
// HZ2-M3P11-01). The row key alone is not unique on this screen: the review
// groups each direction separately over the same counterparty identity
// (src/modules/merchants/domain/merchant-review.ts groups income rows and
// spend rows independently over a key that is the merchant id or the
// counterparty identity), so a counterparty with a spend row and a refund
// renders TWO rows carrying the same data-group-key. Writing or retiring on
// the key alone therefore reached across those two rows and reopened both
// arms of HZ-M3P11-02: naming the second erased the first row's record, and
// a failure on either retired the other's. The claim already MATCHED on
// direction plus label; this makes the identity as specific as the match.
const isSameRow = (
  entry: { readonly rowKey: string; readonly direction: NamingDirection },
  row: { readonly rowKey: string; readonly direction: NamingDirection },
): boolean => entry.rowKey === row.rowKey && entry.direction === row.direction;

// ADDITIVE, never destructive to a sibling: a row replaces its OWN entry
// and touches no other row's.
export const recordNaming = (
  store: NamingClaimStore,
  claim: NamingClaim,
): void => {
  store.entries = [
    ...store.entries.filter(
      (entry) =>
        !isSameRow(entry, { rowKey: claim.rowKey, direction: claim.direction }),
    ),
    claim,
  ];
};

// A refusal or a transport failure retires the entry of the row that
// failed, and only that one.
export const forgetNaming = (
  store: NamingClaimStore,
  rowKey: string,
  direction: NamingDirection,
): void => {
  store.entries = store.entries.filter(
    (entry) => !isSameRow(entry, { rowKey, direction }),
  );
};

export const claimNaming = (
  store: NamingClaimStore,
  {
    direction,
    label,
    resolved,
    now,
    render = (value: string) => value,
  }: {
    readonly direction: NamingDirection;
    readonly label: string;
    readonly resolved: boolean;
    readonly now: number;
    // How the SCREEN renders a name. The row's label is rendered through
    // the card-number masking, so comparing it with the raw typed string
    // compares two different alphabets and a name the masking rewrites
    // would change on the row with nothing said (finding HZ-M3P11-03). The
    // function is injected rather than imported so this module stays pure
    // and the rule is exercised in the fast gate.
    readonly render?: (value: string) => string;
  },
): ClaimOutcome => {
  // Stale entries go first, whatever this row is: a record nobody claimed
  // inside the window is not evidence about any later render.
  store.entries = store.entries.filter(
    (entry) => now - entry.at <= NAMING_CLAIM_WINDOW_MS,
  );
  const mine = store.entries.filter((entry) => entry.direction === direction);
  const exact = mine.find((entry) => label === render(entry.typed));
  if (exact !== undefined) {
    // The server's answer equals the prediction character for character.
    forgetNaming(store, exact.rowKey, exact.direction);
    return "confirmed";
  }
  if (!resolved) {
    return "none";
  }
  const trimmed = mine.find((entry) => label === render(entry.typed.trim()));
  if (trimmed === undefined) {
    return "none";
  }
  forgetNaming(store, trimmed.rowKey, trimmed.direction);
  return "differs";
};

// The store the client leaf shares across its row instances.
export const namingClaims: NamingClaimStore = createNamingClaimStore();
