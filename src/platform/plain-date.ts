// Business dates (booking date, value date, the viewed month) are calendar
// dates with no time and no zone, branded as a YYYY-MM-DD string, never a
// Date (pulse-typescript section 2). A booking date parsed as a Date in
// Brussels and read back in UTC shifts a transaction into the previous
// month; the string form makes that impossible.

import type { Brand } from "./tenancy";

export type PlainDate = Brand<string, "PlainDate">;

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const daysInMonth = (year: number, month: number): number =>
  // Day 0 of the NEXT month is the last day of this one. Date.UTC keeps
  // this a pure calendar computation with no zone involved.
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const isValidPlainDate = (value: string): boolean => {
  const match = PLAIN_DATE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
};

export const plainDate = (value: string): PlainDate => {
  if (!isValidPlainDate(value)) {
    throw new Error(`Not a calendar date: ${value}`);
  }
  return value as PlainDate;
};

// Repository boundary conversions: the database stores DATE columns, which
// Prisma surfaces as a Date at UTC midnight.
export const plainDateFromDbDate = (value: Date): PlainDate =>
  plainDate(value.toISOString().slice(0, 10));

export const plainDateToDbDate = (value: PlainDate): Date =>
  new Date(`${value}T00:00:00.000Z`);
