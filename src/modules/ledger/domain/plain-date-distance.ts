// Whole-day distance between two calendar dates, as pure calendar
// arithmetic: PlainDate strings go through Date.UTC so no timezone can
// shift a booking date (pulse-typescript section 2).

import { plainDate, type PlainDate } from "@/platform/plain-date";

const epochDays = (date: PlainDate): number => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

export const dayDistance = (a: PlainDate, b: PlainDate): number =>
  Math.abs(epochDays(a) - epochDays(b));

export const addDays = (date: PlainDate, days: number): PlainDate => {
  const shifted = new Date((epochDays(date) + days) * 86_400_000);
  return plainDate(shifted.toISOString().slice(0, 10));
};
