// DISPLAY-ONLY masking of a card number, applied where a descriptor is
// RENDERED and nowhere else (M3-P6, decision D-12, hazards H6.4 and H6.7).
// The owner reported an unmasked card number on screen: a card descriptor
// embeds the full number, and the group label for an unresolved
// counterparty IS the normalised descriptor, so the number reached both
// label surfaces.
//
// WHERE THIS MAY BE APPLIED: the month view's group label
// (src/modules/overview/ui/month-view.tsx) and the merchant review's group
// label (src/modules/merchants/ui/merchant-review.tsx). That is the whole
// list.
//
// WHERE IT MUST NEVER BE APPLIED, each with the damage it would do:
//   - Transaction.rawLine and Import.rawContent (prisma/schema/import.prisma).
//     Those are FACTS and facts are immutable (CLAUDE.md non-negotiable 5).
//     Masking a fact would destroy the M3-P2 re-parse contract, because a
//     profile fix re-parses stored raw lines and would then rebuild rows
//     from text the bank never printed.
//   - Any dedup key input (src/modules/import/domain/dedup.ts, a FROZEN
//     recipe). A changed key turns the next re-upload into a full duplicate
//     import.
//   - The normalised grouping key, and above all the hidden counterpartyText
//     value the merchant review form submits, because that value becomes the
//     EXACT MerchantRule pattern (src/modules/merchants/application/
//     assign-merchant.ts). A masked subject would match nothing, so the
//     owner's naming would silently apply to no transaction at all.
//
// This module is in platform/ui because it knows nothing about a
// transaction: it takes a string and returns a string (pulse-frontend
// section 2's test for platform versus a module).

// A CARD-NUMBER RUN IS 13 TO 19 DIGITS ONCE SPACES, DOTS AND DASHES ARE
// REMOVED, never a contiguous run of digits (finding PR3-001). Measured
// through the shipped pipeline on the owner's real statement: descriptors
// carrying a CONTIGUOUS 16-digit run numbered ZERO, while every card row
// carried a separator-insensitive one, because the number is printed
// grouped four by four and the PDF extractor's gap rule inserts those
// spaces. A contiguous-digits regex here would match nothing and could
// never fail, which is the worst shape a guard can have.
//
// The separator may appear at most ONCE between two digits, so this can
// never join two distant numbers into one run. The match is MAXIMAL and the
// window is checked afterwards, so a 20-digit run is left alone whole
// rather than having its first 19 digits masked out of it, which is what a
// bounded greedy match does.
const DIGIT_RUN = /\d(?:[\s.-]?\d)*/g;

const VISIBLE_DIGITS = 4;
const MASK = "****";

// THE LENGTH TEST IS DELIBERATE HERE AND DELIBERATELY ABSENT ONE MODULE
// OVER. The merchants normaliser must NOT key on digit-run length, because
// legitimate structured payment references share the 13-to-19 window (5
// non-card keys in one real statement fall inside it) and a length-keyed
// strip would eat them out of the grouping key. Masking is the opposite
// trade: it is display-only and reversible by reading the fact, so masking
// a long reference costs a reader four visible digits while missing a card
// number costs the exposure the owner reported. Any run in the window is
// masked.
export const maskCardNumbers = (text: string): string =>
  text.replace(DIGIT_RUN, (run) => {
    const digits = run.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) {
      return run;
    }
    return `${MASK} ${digits.slice(-VISIBLE_DIGITS)}`;
  });
