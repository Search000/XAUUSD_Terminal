import { useGetAccountSettings } from '@workspace/api-client-react';

/**
 * Every event time coming from the API server is UTC (either an ISO
 * `datetimeUtc` string, or minutes-from-UTC-midnight for sessions).
 * The user picks a display timezone once in Settings ("System Timezone"),
 * and everything in the app should render times/dates converted to that
 * single offset — that's what this module centralizes so panels don't each
 * do their own (inconsistent) conversion.
 */

// Fixed list of valid GMT offsets — used to constrain the Settings field to
// values we can actually parse, instead of a freeform text input that could
// hold anything (which was the root cause of the timezone setting silently
// not doing anything).
export const GMT_OFFSET_OPTIONS: Array<{ value: string; label: string }> = [
  '-12:00', '-11:00', '-10:00', '-09:30', '-09:00', '-08:00', '-07:00', '-06:00',
  '-05:00', '-04:00', '-03:30', '-03:00', '-02:00', '-01:00', '+00:00', '+01:00',
  '+02:00', '+03:00', '+03:30', '+04:00', '+04:30', '+05:00', '+05:30', '+05:45',
  '+06:00', '+06:30', '+07:00', '+08:00', '+08:45', '+09:00', '+09:30', '+10:00',
  '+10:30', '+11:00', '+12:00', '+12:45', '+13:00', '+14:00',
].map((offset) => ({ value: `GMT${offset}`, label: `GMT${offset}` }));

/** Parse a saved timezone string like "GMT+6" into minutes offset from UTC. */
export function parseGmtOffsetMinutes(tz: string | null | undefined): number {
  if (!tz) return 0;
  const trimmed = tz.trim().toUpperCase();
  if (trimmed === 'UTC' || trimmed === 'GMT') return 0;
  const m = trimmed.match(/^GMT\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

export function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${h}:${m}`;
}

/** Shift a UTC instant by the given offset, returning a Date whose UTC-* fields equal local wall time in that zone. */
function toZoned(utc: Date, offsetMinutes: number): Date {
  return new Date(utc.getTime() + offsetMinutes * 60_000);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ZonedParts {
  /** Unambiguous display date, e.g. "Sat, 1-Aug-2026" */
  dateLabel: string;
  /** "HH:mm" in the target zone */
  timeLabel: string;
  /** "yyyy-MM-dd" key in the target zone, for grouping events by day */
  dateKey: string;
}

/** Convert a UTC Date/ISO string into date + time parts for the given GMT offset. */
export function toZonedParts(utc: Date | string, offsetMinutes: number): ZonedParts {
  const utcDate = typeof utc === 'string' ? new Date(utc) : utc;
  const z = toZoned(utcDate, offsetMinutes);
  const day = DAY_NAMES[z.getUTCDay()];
  const date = z.getUTCDate();
  const month = MONTH_NAMES[z.getUTCMonth()];
  const year = z.getUTCFullYear();
  const hh = String(z.getUTCHours()).padStart(2, '0');
  const mm = String(z.getUTCMinutes()).padStart(2, '0');
  return {
    dateLabel: `${day}, ${date}-${month}-${year}`,
    timeLabel: `${hh}:${mm}`,
    dateKey: `${year}-${String(z.getUTCMonth() + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
  };
}

/** Format a plain calendar Date (already a local day, e.g. from a date-picker) using the same unambiguous style. */
export function formatDateLabel(d: Date): string {
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()}-${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`;
}

/** Convert minutes-from-UTC-midnight (used by /api/xauusd/sessions) into "HH:mm" in the given offset. Handles day wraparound. */
export function minsUtcToZonedTime(mins: number, offsetMinutes: number): string {
  const total = (((mins + offsetMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Hook: reads the user's saved System Timezone setting and returns { offsetMinutes, label }. Defaults to UTC while loading / if unset. */
export function useSystemTimezone(): { offsetMinutes: number; label: string } {
  const { data } = useGetAccountSettings();
  const offsetMinutes = parseGmtOffsetMinutes(data?.timezone);
  return { offsetMinutes, label: formatOffsetLabel(offsetMinutes) };
}
