// The SHARED parse path for every PDF layout template, and the home of
// THE BALANCE CONTRACT (pulse-v0.2-pdf-addendum.md:35, decision D-6):
//
//   opening + sum(parsed transactions) must equal closing, in integer
//   cents, or the parse fails and the import writes NOTHING.
//
// The gate lives HERE, not in any template, so every future template
// inherits it by construction (hazard H2.2: a template that drops or
// duplicates a line fails loudly instead of feeding a silently wrong fact
// into the ledger). Balances are verified in memory and never persisted.

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
      readonly kind: "balance-mismatch";
      readonly openingBalanceCents: number;
      readonly closingBalanceCents: number;
      readonly transactionSumCents: number;
    };

export const parsePdfStatement = (
  pages: readonly PdfPageLines[],
  templateId: string,
): Result<ParsedStatement, PdfStatementParseError> => {
  const template = getTemplateById(templateId);
  if (template === undefined) {
    return err({ kind: "unknown-template" as const, templateId });
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
