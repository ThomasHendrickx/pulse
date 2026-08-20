// The reporting period is the calendar month, compared to the previous
// calendar month; the current month is shown as in progress and never
// compared to a full month (pulse-v1-plan.md decisions and line 206). A
// month is a branded "YYYY-MM" string, the same discipline as PlainDate:
// no Date arithmetic, no zones, pure calendar computation.

import type { PlainDate } from "@/platform/plain-date";
import { plainDate } from "@/platform/plain-date";
import type { Brand } from "@/platform/tenancy";

export type Month = Brand<string, "Month">;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const parseMonth = (raw: string | undefined): Month | undefined =>
  raw !== undefined && MONTH.test(raw) ? (raw as Month) : undefined;

export const monthOfPlainDate = (date: PlainDate): Month =>
  date.slice(0, 7) as Month;

// The household's calendar day for an instant, read in Europe/Brussels:
// the product is a Belgian household's overview, so "today", and with it
// which month is the partial current one, is the Brussels calendar day,
// never the server's UTC date (pulse-typescript section 2's shifted-month
// hazard, applied to the clock instead of a booking date).
export const brusselsDayOf = (instant: Date): PlainDate => {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return plainDate(formatted);
};

export const previousMonth = (month: Month): Month => {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return monthNumber === 1
    ? (`${year - 1}-12` as Month)
    : (`${yearText}-${String(monthNumber - 1).padStart(2, "0")}` as Month);
};

export const nextMonth = (month: Month): Month => {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return monthNumber === 12
    ? (`${year + 1}-01` as Month)
    : (`${yearText}-${String(monthNumber + 1).padStart(2, "0")}` as Month);
};

export const daysInMonth = (month: Month): number => {
  const [yearText, monthText] = month.split("-");
  // Day 0 of the next month is the last day of this one; Date.UTC keeps
  // this pure calendar arithmetic, the same recipe as plain-date.ts.
  return new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
};

// Both bounds inclusive, matching the repository's date filters.
export const monthBounds = (
  month: Month,
): { readonly from: PlainDate; readonly to: PlainDate } => ({
  from: plainDate(`${month}-01`),
  to: plainDate(`${month}-${String(daysInMonth(month)).padStart(2, "0")}`),
});

export const dayOfMonth = (date: PlainDate): number => Number(date.slice(8, 10));

// "YYYY-MM" compares correctly as a string; named so call sites read as
// calendar comparisons rather than string tricks.
export const isAfter = (a: Month, b: Month): boolean => a > b;
