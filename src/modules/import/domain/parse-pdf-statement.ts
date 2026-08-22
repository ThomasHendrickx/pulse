// The SHARED parse path for every PDF layout template, and the home of
// THE BALANCE CONTRACT (pulse-v0.2-pdf-addendum.md:35, decision D-6):
//
//   opening + sum(parsed transactions) must equal closing, in integer
//   cents, or the parse fails and the import writes NOTHING.
//
// The gate lives HERE, not in any template, so every future template
// inherits it by construction (hazard H2.2). Balances are verified in
// memory and never persisted.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round 1, finding
// HZ-001): this comment used to claim a template that drops or
// duplicates a line "fails loudly instead of feeding a silently wrong
// fact into the ledger". That was TRUE ONLY FOR SUM-CHANGING errors: the
// review's executed constructions showed a fabricated zero-amount row, a
// dropped zero-amount row and a dropped compensating pair all passing
// the sum comparison green. The balance gate is blind to zero-sum
// constructions BY CONSTRUCTION; what closes them is structural, in the
// template layer: positional line classification (indented lines are
// data, never structure) and the within-file sequence-continuity gate
// (belfius-current-account-template.ts). One residue remains and is
// stated there: a zero-amount FIRST transaction whose start line is
// corrupted still drops silently, continuity having no lower anchor.
//
// ALSO ENFORCED HERE (fix round 1, finding HZ-002): the stored spec's
// templateVersion must equal the registered template's version, or the
// parse fails closed (template-version-mismatch). A version bump is a
// migration, never a silent reinterpretation of stored bytes; the bump
// procedure is documented at the registry (pdf-template.ts).

import { err, ok, type Result } from "@/platform/result";
import type { ParsedStatement } from "./parse-statement";
import {
  getTemplateById,
  type PdfPageLines,
  type PdfTemplateError,
} from "./pdf-template";

export type PdfStatementParseError =
  | PdfTemplateError
  | {
      // The stored spec names a template this build does not carry: a
      // stale profile from a removed template, failed loudly rather than
      // guessed around.
      readonly kind: "unknown-template";
      readonly templateId: string;
    }
  | {
      // The stored spec names a template version this build does not
      // carry: parsing stored bytes under DIFFERENT template code than
      // the declaration recorded would silently reinterpret facts, so it
      // fails closed until a migration handles the bump (HZ-002).
      readonly kind: "template-version-mismatch";
      readonly templateId: string;
      readonly declaredVersion: number;
      readonly registeredVersion: number;
    }
  | {
      readonly kind: "balance-mismatch";
      readonly openingBalanceCents: number;
      readonly closingBalanceCents: number;
      readonly transactionSumCents: number;
    };

export const parsePdfStatement = (
  pages: readonly PdfPageLines[],
  templateId: string,
  declaredVersion: number,
): Result<ParsedStatement, PdfStatementParseError> => {
  const template = getTemplateById(templateId);
  if (template === undefined) {
    return err({ kind: "unknown-template" as const, templateId });
  }
  if (template.version !== declaredVersion) {
    return err({
      kind: "template-version-mismatch" as const,
      templateId,
      declaredVersion,
      registeredVersion: template.version,
    });
  }
  const parsed = template.parse(pages);
  if (!parsed.ok) {
    return err(parsed.error);
  }
  const { rows, accountIbans, openingBalanceCents, closingBalanceCents } =
    parsed.value;

  // THE HARD GATE, integer cents, zero tolerance.
  const transactionSumCents = rows.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  );
  if (openingBalanceCents + transactionSumCents !== closingBalanceCents) {
    return err({
      kind: "balance-mismatch" as const,
      openingBalanceCents,
      closingBalanceCents,
      transactionSumCents,
    });
  }

  return ok({ rows, accountIbans });
};
