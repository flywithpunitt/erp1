/**
 * Stable display for spreadsheet cells: DD-MM-YYYY HH:mm (local time), matching typical Excel regional text.
 * Used so ISO / BSON / JS Date strings are not left for Luckysheet to parse into "Thu Jan 29 2026" style.
 */

export function formatLocalDdMmYyyyHhMm(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Already looks like Excel text (day-month-year first), e.g. 28-02-2026 13:00 */
function looksLikeDdMmYyyyText(s: string): boolean {
  return /^\d{1,2}-\d{1,2}-\d{4}(\s|$)/.test(s.trim());
}

/**
 * Rewrites machine / ISO / JS default date strings into DD-MM-YYYY HH:mm.
 * Leaves values that already look like Excel display text unchanged.
 */
export function rewriteMachineDateStringToExcelDisplay(s: string): string {
  const t = s.trim();
  if (!t) return "";

  if (looksLikeDdMmYyyyText(t)) return t;

  // e.g. "Thu Jan 29 2026" or "Thu Jan 29 2026 12:00:00 GMT+..."
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return formatLocalDdMmYyyyHhMm(d);
  }

  // ISO 8601 / Mongo JSON: 2026-01-29T12:00:00.000Z
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return formatLocalDdMmYyyyHhMm(d);
  }

  return t;
}
