import * as XLSX from "xlsx";
import { rewriteMachineDateStringToExcelDisplay } from "@/lib/excelDateDisplay";

/** Luckysheet treats `ct.t === "n"` as numeric — Excel serials stay as decimals. Use `t: "s"` for formatted text. */
export const LUCKYSHEET_TEXT_CT = { fa: "General", t: "s" } as const;

/** Only keep visual/style keys — drop `f`/`qp`/etc. that may hold objects and show as [object Object]. */
const LUCKYSHEET_STYLE_KEYS = new Set([
  "bg", "fc", "bl", "it", "un", "fs", "ff", "ht", "vt", "tb", "tr", "rt",
]);

function pickLuckysheetStyleFields(existing: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LUCKYSHEET_STYLE_KEYS) {
    if (k in existing && existing[k] !== undefined) out[k] = existing[k];
  }
  return out;
}

export type LuckysheetSparseCell = { r: number; c: number; v: unknown };

const BAD_OBJECT_STRING = "[object Object]";

function isBadDisplayString(s: string): boolean {
  return s === BAD_OBJECT_STRING;
}

/** Strip the literal JS bug string saved in older uploads / bad String(object) paths. */
export function sanitizeDisplayString(s: string): string {
  return isBadDisplayString(s) ? "" : s;
}

/**
 * Recursively unwrap Excel/Luckysheet cell payloads to a leaf primitive (never return a stray object).
 */
export function unwrapCellValueToLeaf(val: unknown, depth = 0): string | number | boolean | null {
  if (depth > 14) return null;
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    if (isBadDisplayString(val)) return null;
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") return val;

  // Never use String(Date) — that is JS locale (e.g. "Thu Jan 29 2026"), not Excel’s display text.
  // Prefer `m` / string `v` on the cell object; if the only leaf is a Date, we have nothing to show.
  if (val instanceof Date) {
    return null;
  }

  if (typeof val !== "object" || val === null) return String(val);

  const o = val as Record<string, unknown>;

  if (typeof o.error === "string") return o.error;

  if (Array.isArray(o.richText)) {
    const s = (o.richText as Array<{ text?: string }>)
      .map((r) => (r && typeof r.text === "string" ? r.text : ""))
      .join("");
    return s.length ? s : null;
  }

  if (typeof o.text === "string" && o.text.length) return o.text;

  // Luckysheet: `m` is the rendered value — read it BEFORE `v` so a bad nested `v` does not win.
  if (typeof o.m === "string" && o.m.length && !isBadDisplayString(o.m)) return o.m;
  if (typeof o.m === "number" || typeof o.m === "boolean") return o.m;

  if ("result" in o && o.result !== undefined) {
    return unwrapCellValueToLeaf(o.result, depth + 1);
  }

  if ("v" in o) {
    const inner = o.v;
    if (inner === val) return null;
    return unwrapCellValueToLeaf(inner, depth + 1);
  }

  return null;
}

/**
 * Turn Excel serial datetimes (e.g. 46052.18) into dd-mm-yyyy hh:mm text.
 * Leaves values that decode to implausible years or large “counter” numbers unchanged.
 */
export function normalizeExcelSerialInDisplayValue(val: unknown): string | number {
  if (val === undefined || val === null) return "";
  let n: number | null = null;
  if (typeof val === "number" && Number.isFinite(val)) n = val;
  else if (typeof val === "string") {
    const t = val.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const parsed = parseFloat(t);
      if (Number.isFinite(parsed)) n = parsed;
    }
  }
  if (n === null) {
    if (typeof val === "string") {
      if (isBadDisplayString(val)) return "";
      return val;
    }
    if (typeof val === "number" || typeof val === "boolean") return val as string | number;
    return "";
  }

  if (n < 0 || n > 2958465) return val as string | number;
  const d = XLSX.SSF.parse_date_code(n);
  if (!d) return val as string | number;
  const y = d.y;
  const hasTime = Math.abs(n - Math.floor(n)) > 1e-9;
  if (y < 1950 || y > 2100) return val as string | number;
  if (!(hasTime || n >= 20000)) return val as string | number;

  const pad = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${pad(d.d)}-${pad(d.m)}-${d.y} ${pad(d.H)}:${pad(d.M)}`;
}

/** Unwrap nested cell objects only — do not reformat numbers/dates (keeps Excel/upload text as stored). */
export function luckysheetValueToPlainString(val: unknown): string {
  const leaf = unwrapCellValueToLeaf(val);
  if (leaf === null) return "";
  const out = String(leaf);
  return isBadDisplayString(out) ? "" : out;
}

function normalizeLuckysheetCellV(v: unknown): unknown {
  if (v === null || v === undefined) return v;

  const toTextCell = (display: string, existing?: Record<string, unknown>) => {
    if (!existing) {
      return { v: display, m: display, ct: LUCKYSHEET_TEXT_CT };
    }
    const styles = pickLuckysheetStyleFields(existing);
    return {
      ...styles,
      v: display,
      m: display,
      ct: LUCKYSHEET_TEXT_CT,
    };
  };

  if (typeof v !== "object" || v === null) {
    if (typeof v === "string") {
      return rewriteMachineDateStringToExcelDisplay(sanitizeDisplayString(v));
    }
    return v;
  }

  const o = v as Record<string, unknown>;
  // Saved uploads without `ct` — Luckysheet may treat date-like strings as dates and reformat (losing `/` vs `-` mix).
  if (
    typeof o.v === "string" &&
    typeof o.m === "string" &&
    o.m.trim() !== "" &&
    !isBadDisplayString(o.m) &&
    o.ct === undefined
  ) {
    const vv = rewriteMachineDateStringToExcelDisplay(sanitizeDisplayString(o.v));
    const mm = rewriteMachineDateStringToExcelDisplay(sanitizeDisplayString(o.m));
    return { ...o, v: vv, m: mm, ct: LUCKYSHEET_TEXT_CT };
  }

  const plain = rewriteMachineDateStringToExcelDisplay(luckysheetValueToPlainString(v));
  // Always flatten Luckysheet cell objects so nested `{ v: {…} }` never reaches the grid as [object Object].
  return toTextCell(plain, v as Record<string, unknown>);
}

/** Run on load (API or client) so Luckysheet never shows raw Excel serials or [object Object]. */
export function normalizeLuckysheetCelldataForDisplay<T extends LuckysheetSparseCell>(celldata: T[]): T[] {
  return celldata.map((entry) => ({
    ...entry,
    v: normalizeLuckysheetCellV(entry.v),
  }));
}
