/**
 * CALENDARS ARE DATA — the arithmetic behind the date ops.
 *
 * The demo's own time axis is the MMWR week: week 1 is the Sunday–Saturday week
 * containing January 4, and the source's rows already carry a `week` column
 * counted that way. An ISO week (Monday–Sunday, week 1 contains January 4) is
 * an equally legitimate week number that disagrees with it at every year
 * boundary — and disagrees SILENTLY, because both answers are integers and
 * neither is wrong. Nothing downstream could catch it: the axis, the
 * `dateTrunc` group and any join back onto the source's own `week` would all
 * inherit the disagreement.
 *
 * So the law is that a week says which calendar counted it, on the node, in the
 * declaration, replayed with it — never a locale, never a runtime setting,
 * never a default. The judge REQUIRES `calendar` on the ops whose answer moves
 * with it and refuses it on every op whose answer does not.
 *
 * Two companions live here for the same reason:
 *
 *   - **A date is an ISO string.** Ten characters, `YYYY-MM-DD`, or a full ISO
 *     timestamp whose date half is read (a `T` must be followed by a time).
 *     Everything else is ABSENT — including `2026/01/04`, which `Date.parse` in
 *     V8 will happily read as a date and another engine will not. This is
 *     stricter than {@link ../data/bins.ts} deliberately: a bin edge is a
 *     picture, a derived column is a commitment. The same law bounds what this
 *     file WRITES: {@link isoOf} mints only the ten-character years
 *     {@link epochDayOf} reads back, so the two are exact inverses.
 *   - **There is no clock.** No `today`, no `now`, nowhere — a column whose
 *     value depends on when it ran cannot be replayed, and the op table refuses
 *     both names for exactly that sentence. Nothing in this folder reads the
 *     clock; the `Date`s below are arithmetic over a day number, and the one
 *     door that takes a `Date` IN ({@link isoOfMoment}) reads its UTC day off
 *     the value it was handed.
 *
 * The first customers are the seven date ops in {@link ./ops.ts}.
 */

import type { Calendar } from './types.js';

// ── the vocabulary ───────────────────────────────────────────────────────────

/** The calendars a node may name, in the order a refusal lists them. */
export const CALENDARS: readonly Calendar[] = Object.freeze(['iso', 'mmwr']);

/**
 * Which weekday each calendar's week STARTS on, as a Sunday-0 index. This one
 * table is the whole difference between the two: `weekOf`, `dayOfWeek` and
 * `dateTrunc(…, 'week')` read it and nothing else knows.
 */
export const FIRST_DAY: Readonly<Record<Calendar, number>> = Object.freeze({ iso: 1, mmwr: 0 });

/** The units the date ops count in, in the order a refusal lists them. */
export const DATE_UNITS = Object.freeze(['year', 'month', 'week', 'day'] as const);

/** One of {@link DATE_UNITS}. */
export type DateUnit = (typeof DATE_UNITS)[number];

/** The days each month carries in a common year; February's 29 is the one exception {@link isLeap} names. */
const MONTH_LENGTHS: readonly number[] = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

// ── days, not moments ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** The date half, then optionally a `T` and a TIME — `T` followed by anything else is not a timestamp and not a date. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** Whether a year carries a February 29. */
const isLeap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** How many days a month really has — the check that makes `2026-02-30` absent rather than March 2. */
export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_LENGTHS[month - 1]!;
}

/** The day number of a year/month/day, counted from 1970-01-01. `setUTCFullYear` and not `Date.UTC`, which maps year 26 to 1926. */
export function dayOf(year: number, month: number, day: number): number {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return Math.round(at.getTime() / DAY_MS);
}

/**
 * The window an ISO date can name back: the four-digit years {@link epochDayOf}
 * will read. WHY the bound is this and not a JS `Date`'s reach: a derived
 * column is a commitment, and a day {@link isoOf} cannot spell as ten characters
 * is absent, not spelled wrong — text no reader here would call a date.
 */
const EARLIEST_DAY = dayOf(0, 1, 1);
const LATEST_DAY = dayOf(9999, 12, 31);

/** A day number back to its parts. */
export function partsOf(day: number): { readonly year: number; readonly month: number; readonly day: number } {
  const at = new Date(day * DAY_MS);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

/**
 * A date as this folder reads one: the day number, or `null` for text that is
 * not an ISO date. The one place the "non-ISO date text is absent" rule lives.
 */
export function epochDayOf(text: string): number | null {
  const found = ISO_DATE.exec(text);
  if (found === null) return null;
  const year = Number(found[1]);
  const month = Number(found[2]);
  const day = Number(found[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return dayOf(year, month, day);
}

/** A day number as the ten characters a column holds — or absent, when the arithmetic ran off the end of what a date can be. */
export function isoOf(day: number): string | null {
  if (!Number.isSafeInteger(day) || day < EARLIEST_DAY || day > LATEST_DAY) return null;
  const { year, month, day: date } = partsOf(day);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/**
 * A `Date` brought over into the grammar's own shape: the ISO string of its
 * UTC calendar day, or absent for an invalid one.
 *
 * WHY here and not at the walker: this file owns what a date is. The engine
 * calls a column `date` ONLY when it holds `Date` objects (`../data/fold.ts`,
 * `TypeTally`), so this is the one door such a column enters the arithmetic
 * by; the UTC day is the reading a replay will make on every machine, which is
 * what `../data/predicate.ts` already reads off a date cell.
 */
export function isoOfMoment(at: Date): string | null {
  const ms = at.getTime();
  return Number.isFinite(ms) ? isoOf(Math.floor(ms / DAY_MS)) : null;
}

// ── weeks, which is where the calendar shows ─────────────────────────────────

/** Sunday-0 weekday of a day number. Day 0 — 1970-01-01 — was a Thursday. */
const sundayIndexOf = (day: number): number => (((day + 4) % 7) + 7) % 7;

/** How far into its week a day sits, on this calendar. */
const offsetOf = (day: number, calendar: Calendar): number => (sundayIndexOf(day) - FIRST_DAY[calendar] + 7) % 7;

/** The day a day's week began, on this calendar. */
export function weekStartOf(day: number, calendar: Calendar): number {
  return day - offsetOf(day, calendar);
}

/** The weekday, 1…7, where 1 is the day this calendar's week starts on — Monday for `iso`, Sunday for `mmwr`. */
export function weekdayOf(day: number, calendar: Calendar): number {
  return offsetOf(day, calendar) + 1;
}

/** Where a year's week 1 begins: the week containing January 4 — the rule both calendars share, and the only rule they share. */
const week1Of = (year: number, calendar: Calendar): number => weekStartOf(dayOf(year, 1, 4), calendar);

/**
 * The week number, on the named calendar.
 *
 * A day before its own year's week 1 belongs to the last week of the year
 * before; a day on or after the NEXT year's week 1 is that year's week 1. Both
 * arms are the same fact seen from either side of a year boundary, which is
 * precisely where the two calendars disagree.
 *
 * WHY a reader must be told this: the number is counted against the WEEK
 * year, which is not the calendar year at a boundary — `2025-12-29` is iso
 * week 1, and `year` still says 2025. Grouping by `(year, week)` puts that row
 * fifty-one weeks from where it belongs, and both answers are integers and
 * neither is wrong. Group by `dateTrunc(date, 'week')` instead: one value per
 * week, and it cannot disagree with itself.
 */
export function weekOf(day: number, calendar: Calendar): number {
  const { year } = partsOf(day);
  const own = week1Of(year, calendar);
  const next = week1Of(year + 1, calendar);
  const start = day < own ? week1Of(year - 1, calendar) : day >= next ? next : own;
  return Math.floor((weekStartOf(day, calendar) - start) / 7) + 1;
}

// ── truncate, add, difference ────────────────────────────────────────────────

/**
 * The day the unit containing this day began. `week` is the only unit that
 * needs the calendar — the others begin where every calendar agrees they begin,
 * which is why the parameter is optional and the judge only REQUIRES a calendar
 * on a `dateTrunc` whose unit is `week`.
 */
export function truncOf(day: number, unit: DateUnit, calendar: Calendar | undefined): number {
  const { year, month } = partsOf(day);
  if (unit === 'year') return dayOf(year, 1, 1);
  if (unit === 'month') return dayOf(year, month, 1);
  if (unit === 'week') return weekStartOf(day, calendar!);
  return day;
}

/**
 * A whole number of units later (or earlier).
 *
 * Month and year arithmetic CLAMPS to the end of the month it lands in — the
 * 31st of January plus one month is the 28th of February, because there is no
 * 31st there and inventing March 3 would be a different day than the one asked
 * for. A count that is not a whole number is absent: half a month is not a date.
 */
export function addOf(day: number, count: number, unit: DateUnit): number | null {
  if (!Number.isInteger(count)) return null;
  if (unit === 'day') return day + count;
  if (unit === 'week') return day + count * 7;
  const { year, month, day: date } = partsOf(day);
  const months = year * 12 + (month - 1) + (unit === 'year' ? count * 12 : count);
  const toYear = Math.floor(months / 12);
  const toMonth = months - toYear * 12 + 1;
  return dayOf(toYear, toMonth, Math.min(date, daysInMonth(toYear, toMonth)));
}

/** Whole months from one day to another, counted the way a person counts them: the 31st to the 28th is not a month. */
function wholeMonths(from: number, to: number): number {
  const a = partsOf(from);
  const b = partsOf(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months > 0 && b.day < a.day) return months - 1;
  if (months < 0 && b.day > a.day) return months + 1;
  return months;
}

/** How many WHOLE units lie from one day to another — negative when the second is earlier. Truncated, never rounded. */
export function diffOf(from: number, to: number, unit: DateUnit): number {
  if (unit === 'day') return to - from;
  if (unit === 'week') return Math.trunc((to - from) / 7);
  const months = wholeMonths(from, to);
  return unit === 'month' ? months : Math.trunc(months / 12);
}
