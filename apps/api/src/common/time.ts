/** Saat dilimi yardımcıları (harici kütüphane olmadan, Intl ile). */

function offsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** "2026-10-28" + 540 dk (09:00) yerel saat => UTC Date */
export function zonedTime(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  const off = offsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - off * 60000);
  const off2 = offsetMinutes(result, timeZone);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

/** UTC anının yerel tarih (YYYY-MM-DD), hafta günü ve gün içi dakikası. */
export function toZoned(utc: Date, timeZone: string) {
  const local = new Date(utc.getTime() + offsetMinutes(utc, timeZone) * 60000);
  return {
    date: local.toISOString().slice(0, 10),
    weekday: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
