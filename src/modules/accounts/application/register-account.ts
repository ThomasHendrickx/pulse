// REGISTERING AN ACCOUNT THE HOUSEHOLD OWNS, WITHOUT IMPORTING A STATEMENT
// FOR IT (M3-P14). This is the use case the owner's scenario asks for: ten
// accounts, one uploaded first, its transfers to the other nine offered as
// merchants. They are not merchants; they are the household's own accounts,
// and until this existed the only way an account could come into being was
// by importing a file for it.
//
// IT IS A DECLARATION WRITE FOLLOWED BY A RECOMPUTE, exactly like naming a
// merchant. Nothing here writes a transaction row. Registration HEALS rows
// that are already there, because interpretation runs over a window across
// all pot accounts rather than over the rows just imported, so declaring an
// account reclassifies every past row that references it. Retroactivity is
// the recompute call at the bottom, never a row update.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import {
  canonicalAccountNumber,
  verifyAccountNumber,
  type AccountNumberError,
} from "@/platform/account-number";
import type { AccountRole } from "../domain/account-role";
import type {
  AccountRecord,
  AccountRepositoryPort,
  DeclarationChangePreviewPort,
  RecomputeInterpretation,
} from "./ports";

export type RegisterAccountError =
  | { readonly kind: "empty-label" }
  | { readonly kind: "empty-bank" }
  // A CARD IS NOT REGISTERED HERE, AND THE FORM HAS NO PATH THAT REACHES
  // AN ACCOUNT WITHOUT A NUMBER (decision D-48). A card account carries no
  // account number by design and is recognised through its bound source
  // profile at import time, so a pre-registered card would have no
  // identifier for the import path to adopt it by and would become a SECOND
  // account. The duplicate hazard is closed by construction rather than by
  // a mechanism. An empty submission lands on the account-number-empty
  // refusal below, whose copy says how a card IS registered.
  | { readonly kind: "invalid-account-number"; readonly reason: AccountNumberError }
  | { readonly kind: "already-registered"; readonly existing: AccountRecord };

export type RegisterAccountInput = {
  readonly label: string;
  readonly bank: string;
  readonly role: AccountRole;
  readonly accountNumber: string;
};

export type RegisterAccountOutcome = {
  readonly account: AccountRecord;
  // Named to the owner at the moment of registration (decision D-49): a
  // naming they made before registering the account stops applying, and
  // what they must not have is a decision of theirs that silently vanished.
  readonly merchantRulesStoppedMatching: number;
};

export type RegisterAccountDependencies = {
  readonly accounts: Pick<
    AccountRepositoryPort,
    "createAccount" | "findAccountByIban" | "listAccounts"
  >;
  readonly preview: DeclarationChangePreviewPort;
  readonly recompute: RecomputeInterpretation;
};

export const registerAccount = async (
  context: HouseholdContext,
  deps: RegisterAccountDependencies,
  input: RegisterAccountInput,
): Promise<Result<RegisterAccountOutcome, RegisterAccountError>> => {
  const label = input.label.trim();
  if (label === "") {
    return err({ kind: "empty-label" as const });
  }
  const bank = input.bank.trim();
  if (bank === "") {
    return err({ kind: "empty-bank" as const });
  }
  // AN EMPTY ACCOUNT NUMBER IS THE FIRST OF CRITERION 14.12'S FOUR
  // REFUSALS, not a fifth reason of its own. It used to be a separate
  // "required" error, which meant the refusal the criterion names as "empty
  // after canonicalisation" was unreachable through this use case: the
  // trimmed check fired first and answered something else. Same refusal,
  // one name, and the copy for it is the one that also says how a card is
  // registered, because an empty number is what a household trying to
  // register a card would submit.

  // A REGISTRATION THE ENGINE CANNOT USE IS REFUSED AT THE FORM, NOT
  // ACCEPTED SILENTLY (criterion 14.12, DR-0028). An account number
  // mistyped by one character matches nothing in classification, so the
  // transfer falls through to the sign rule, lands in the spend total and
  // is offered on the naming screen: a state indistinguishable from never
  // having registered at all, and one the household has no way to see.
  const verdict = verifyAccountNumber(input.accountNumber);
  if (!verdict.ok) {
    return err({
      kind: "invalid-account-number" as const,
      reason: verdict.error,
    });
  }
  const iban = verdict.canonical;

  // ADOPTION, NOT DUPLICATION (criterion 14.3). Any surface form of an
  // account number the household has already registered resolves to the
  // same account, and no path here creates a second one. The per-household
  // uniqueness constraint is the backstop behind this check, not the
  // mechanism.
  const existing = await deps.accounts.findAccountByIban(context, iban);
  if (existing !== null) {
    return err({ kind: "already-registered" as const, existing });
  }

  // THE DRY RUN RUNS BEFORE THE WRITE (decision D-58), over the declaration
  // set as it WOULD BE, so the number reported is the number the recompute
  // below actually produces rather than a second rule's guess at it.
  const current = await deps.accounts.listAccounts(context);
  const currentDeclared = current.map((account) => ({
    id: account.id,
    role: account.role,
    ...(account.iban === undefined
      ? {}
      : { iban: canonicalAccountNumber(account.iban) }),
  }));
  // REGISTRATION READS ONE FIELD OF THIS PREVIEW, and says so (finding
  // CR-H2-02). Before this, every registration paid for a full declaration
  // dry run whose three money deltas and row count were computed and thrown
  // away, plus a second fetch of the account list this function had already
  // loaded. Both are now avoided: the list is handed over, and the second
  // interpretation pass is skipped whenever nothing resolved to a merchant
  // before the change, which is precisely the state a household registering
  // its accounts for the first time is in.
  //
  // WHAT IS NOT CHANGED: the dry run still runs BEFORE the write (decision
  // D-58), over the declaration set as it WOULD BE, so the number reported
  // is the number the recompute below actually produces.
  const preview = await deps.preview(context, {
    only: "merchant-rules-stopped-matching" as const,
    currentAccounts: currentDeclared,
    proposedAccounts: [
      ...currentDeclared,
      { id: `pending:${iban}`, role: input.role, iban },
    ],
  });

  const account = await deps.accounts.createAccount(context, {
    label,
    bank,
    role: input.role,
    iban,
  });
  // The declaration is written; the recompute is what carries it to every
  // past row that references the account. Exactly once per registration.
  await deps.recompute(context);
  return ok({
    account,
    merchantRulesStoppedMatching: preview.merchantRulesStoppedMatching,
  });
};
