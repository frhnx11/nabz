import { IST_OFFSET_MINUTES } from "./constants";

/**
 * Survey weeks are ISO weeks (Monday to Sunday) in India Standard Time.
 *
 * A week is identified by its start date, "YYYY-MM-DD" (always a Monday, IST calendar date), which is
 * what the database stores. The human label is the ISO week, e.g. "2026-W44" (Oct 26 – Nov 1, 2026).
 *
 * IST is a fixed UTC+05:30 with no daylight saving, so all of this is plain arithmetic on UTC dates
 * and never depends on the machine's local timezone.
 */

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LABEL_RE = /^(\d{4})-W(\d{2})$/;

/** Parses "YYYY-MM-DD" to a UTC-midnight Date, rejecting impossible dates such as 2026-02-30. */
function parseDate(date: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (formatDate(d) !== date) throw new Error(`Not a real date: "${date}"`);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6, for a UTC-midnight date. */
function isoWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** The IST calendar date ("YYYY-MM-DD") on which an instant falls. */
export function istDate(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid date");
  return formatDate(new Date(instant.getTime() + IST_OFFSET_MS));
}

/** The Monday (IST) of the survey week containing an instant. */
export function weekStartOf(instant: Date): string {
  const day = parseDate(istDate(instant));
  return formatDate(new Date(day.getTime() - isoWeekday(day) * DAY_MS));
}

function assertWeekStart(weekStart: string): Date {
  const d = parseDate(weekStart);
  if (isoWeekday(d) !== 0) throw new Error(`Week start must be a Monday, got ${weekStart}`);
  return d;
}

/** Moves a week start by n weeks (negative for earlier weeks). */
export function addWeeks(weekStart: string, n: number): string {
  if (!Number.isInteger(n)) throw new Error("addWeeks expects an integer");
  return formatDate(new Date(assertWeekStart(weekStart).getTime() + n * 7 * DAY_MS));
}

/** "2026-10-26" → "2026-W44". ISO 8601: the week belongs to the year that contains its Thursday. */
export function weekLabel(weekStart: string): string {
  const monday = assertWeekStart(weekStart);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** "2026-W44" → "2026-10-26". Rejects weeks that don't exist (e.g. W53 in a 52-week year). */
export function weekStartFromLabel(label: string): string {
  const m = LABEL_RE.exec(label);
  if (!m) throw new Error(`Expected a week like 2026-W44, got "${label}"`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) throw new Error(`No such week: ${label}`);
  // January 4th is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - isoWeekday(jan4) * DAY_MS;
  const start = formatDate(new Date(week1Monday + (week - 1) * 7 * DAY_MS));
  if (weekLabel(start) !== label) throw new Error(`No such week: ${label}`);
  return start;
}

/** The instants bounding a survey week: [start, end), i.e. Monday 00:00 IST to next Monday 00:00 IST. */
export function weekBounds(weekStart: string): { start: Date; end: Date } {
  const monday = assertWeekStart(weekStart).getTime() - IST_OFFSET_MS;
  return { start: new Date(monday), end: new Date(monday + 7 * DAY_MS) };
}
