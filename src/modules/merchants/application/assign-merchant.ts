// Manual assignment: an unresolved counterparty is named in one click, and
// the naming is a DECLARATION, never a row edit (pulse-domain section 2
// rule 2, hazard H3.1). The use case writes a MerchantRule (EXACT, on the
// counterparty IDENTITY KEY since M3-P12), creating the Merchant if absent,
// then triggers recompute so the rule applies to every past matching
// transaction; future imports pick it up through the same resolver. No
// transaction row is touched here: the assignment reaches rows only
// through interpretation re-derived from facts plus declarations, which is
// exactly why the next recompute confirms it instead of undoing it.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRuleLike } from "../domain/merchant-rule";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
  compactAccount,
  identityBasisOfKey,
  identityRemainder,
  isTrustedCounterpartyAccount,
} from "../domain/counterparty-identity";
import { normaliseCounterparty } from "../domain/normalise-counterparty";
import type {
  MerchantRecord,
  MerchantRepositoryPort,
  RecomputeInterpretation,
} from "./ports";

export type AssignMerchantError =
  | { readonly kind: "empty-merchant-name" }
  | { readonly kind: "empty-counterparty" }
  // The subject is not a counterparty identity key at all: it carries
  // neither namespace. The page that submitted it was rendered before this
  // phase deployed (decision D-46's window), so the key it holds is a
  // pre-migration normalised text and a rule written on it could never
  // match anything. REFUSED AND SHOWN rather than written (criterion 12.18).
  | { readonly kind: "unnamespaced-counterparty" }
  // An account-basis subject whose remainder is empty, or which the trust
  // gate refuses. Writing it would attach the naming to a key the derivation
  // can never produce.
  | { readonly kind: "untrusted-counterparty-account" }
  // A DESCRIPTOR-basis subject with nothing after the namespace (fix round,
  // finding HZ-M3P12-01). The row it came from carries no counterparty text
  // at all, so there is nothing to identify a counterparty BY; naming it
  // would attach every other such row of the household to the same merchant.
  // Before this phase the same subject arrived as the empty string and the
  // writer refused it; this is that refusal restored.
  | { readonly kind: "unidentifiable-counterparty" }
  // A DESCRIPTOR-basis subject that is not what the normaliser would emit for
  // itself (fix round two, findings CR2-M3P12-08 and HZ-M3P12-R2-02). Every
  // key the derivation produces is already normalised, so a subject that is
  // not a fixed point of the normaliser did not come from a rendered group,
  // and storing it verbatim would write a rule no derived key can ever equal.
  // The account branch REPAIRS instead of refusing, because there is exactly
  // one canonical form of an account and the gate already computed it; a
  // descriptor has no such single repair, so this refuses.
  | { readonly kind: "non-canonical-counterparty" };

export type AssignMerchantInput = {
  // The counterparty IDENTITY KEY being named, exactly as the review screen
  // rendered it (M3-P12). It is NO LONGER a raw text: the rule subject is
  // the key verbatim, so what the form submits and what the resolver later
  // matches are the same string by construction rather than because two
  // normalisations agree.
  readonly counterpartyText: string;
  readonly merchantName: string;
};

export type AssignMerchantOutcome = {
  readonly merchant: MerchantRecord;
  readonly rule: MerchantRuleLike;
};

export type AssignMerchantDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    "findMerchantByName" | "createMerchant" | "upsertRule"
  >;
  readonly recompute: RecomputeInterpretation;
};

export const assignMerchant = async (
  context: HouseholdContext,
  deps: AssignMerchantDependencies,
  input: AssignMerchantInput,
): Promise<Result<AssignMerchantOutcome, AssignMerchantError>> => {
  const name = input.merchantName.trim();
  if (name === "") {
    return err({ kind: "empty-merchant-name" as const });
  }
  // THE WRITE BOUNDARY (criterion 12.18). This REPLACES the normalisation
  // that used to happen here, and the replacement is not optional: with the
  // normalisation gone, an un-namespaced subject would be written verbatim
  // as a rule that can never match a key, and a stale page is exactly the
  // thing that submits one (hazard H12.21). The subject is stored VERBATIM
  // after these checks; normalising it again would uppercase the namespace.
  const pattern = input.counterpartyText;
  if (pattern.trim() === "") {
    return err({ kind: "empty-counterparty" as const });
  }
  const basis = identityBasisOfKey(pattern);
  if (basis === undefined) {
    return err({ kind: "unnamespaced-counterparty" as const });
  }
  // THE BARE NAMESPACE, REFUSED ON BOTH BASES (fix round, finding
  // HZ-M3P12-01). Before the namespaces existed this subject arrived as the
  // empty string and the normalise-and-refuse guard stopped it; namespacing
  // made it non-empty, so the trim test above passes it and only the account
  // branch below caught it. A rule on a bare namespace is the worst thing
  // this module can store: EXACT it would name every row that carries no
  // counterparty text, and PREFIX or PATTERN it would name every row of that
  // basis outright (hazard H12.26). The account side keeps its own error
  // kind, because for an account the honest thing to tell the reader is that
  // the number could not be read.
  // TRIMMED HERE, strict in the matcher, and the asymmetry is deliberate: a
  // subject arriving from a form is not a derived key, and a remainder that
  // is whitespace only identifies no counterparty either. The matcher must
  // stay strict, because `descriptor: ` is a legitimate PREFIX rule that
  // pass one is required to preserve (criterion 12.21).
  if ((identityRemainder(pattern) ?? "x").trim() === "") {
    return err(
      basis === "account"
        ? ({ kind: "untrusted-counterparty-account" } as const)
        : ({ kind: "unidentifiable-counterparty" } as const),
    );
  }
  // THE SUBJECT THE WRITER STORES IS THE SUBJECT THE WRITER VALIDATED (fix
  // round two, findings CR2-M3P12-08 and HZ-M3P12-R2-02). The trust gate
  // COMPACTS AND UPPERCASES INTERNALLY before testing, so it accepted an
  // account written spaced or lowercase; the boundary then stored the
  // submitted string verbatim, while counterpartyIdentity only ever emits the
  // compact uppercase form. The two could never be equal, so the naming was
  // accepted and reached zero rows, with no error anywhere. That is the exact
  // outcome criterion 12.18 exists to prevent, arriving through a value that
  // passes the gate the criterion enumerates.
  //
  // Today the only submitter is the hidden field on the review screen, which
  // carries a derived key, so this needs a hand-made post to reach. It stops
  // needing one the moment anything else writes a subject, which is what the
  // slice-5 accepted-answer path the schema reserves PREFIX and PATTERN for
  // will do.
  let canonical = pattern;
  if (basis === "account") {
    const account = pattern.slice(ACCOUNT_NAMESPACE.length);
    if (
      compactAccount(account) === "" ||
      !isTrustedCounterpartyAccount(account)
    ) {
      return err({ kind: "untrusted-counterparty-account" as const });
    }
    // REPAIRED, not refused: compactAccount is a total function with one
    // answer, and it is the same function the derivation applies, so the
    // stored key is the key counterpartyIdentity would derive.
    canonical = `${ACCOUNT_NAMESPACE}${compactAccount(account)}`;
  } else {
    // REFUSED, not repaired: normaliseCounterparty is a lossy grammar rather
    // than a canonicalisation, so re-running it over a subject that is
    // already a key is not a repair and could change what the owner named.
    const descriptor = pattern.slice(DESCRIPTOR_NAMESPACE.length);
    if (normaliseCounterparty(descriptor) !== descriptor) {
      return err({ kind: "non-canonical-counterparty" as const });
    }
  }
  const merchant =
    (await deps.merchants.findMerchantByName(context, name)) ??
    (await deps.merchants.createMerchant(context, name));
  const rule = await deps.merchants.upsertRule(context, {
    merchantId: merchant.id,
    kind: "EXACT",
    pattern: canonical,
  });
  // The declaration is written; recompute is what carries it to every past
  // matching transaction (charter: corrections are declarations, recompute
  // applies them). Retroactivity is this line, not a row update.
  await deps.recompute(context);
  return ok({ merchant, rule });
};
