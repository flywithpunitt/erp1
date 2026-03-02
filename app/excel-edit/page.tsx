"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const LUCKYSHEET_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js",
  "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/js/plugin.js",
  "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/luckysheet.umd.js",
];

interface ExcelFile {
  id: string;
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

declare global {
  interface Window {
    luckysheet?: {
      create: (options: LuckysheetOptions) => void;
      destroy: () => void;
      getAllSheets: () => LuckysheetSheet[] | null;
      getCellValue: (row: number, col: number, opts?: { type?: "v" | "m"; order?: number }) => unknown;
      transToData?: (celldata: unknown[]) => unknown[][];
      transToCellData?: (data: unknown[][]) => unknown[];
    };
    luckysheetfile?: LuckysheetSheet[];
  }
}

interface LuckysheetCellValue {
  r: number;
  c: number;
  v: string | number | { v: string | number; m?: string; ct?: unknown };
}

interface LuckysheetSheet {
  name?: string;
  index?: number;
  status?: number;
  order?: number;
  row?: number;
  column?: number;
  celldata?: LuckysheetCellValue[];
  data?: (string | number | null)[][];
  config?: Record<string, unknown>;
}

interface LuckysheetOptions {
  container: string;
  title?: string;
  lang?: string;
  data: LuckysheetSheet[];
  showinfobar?: boolean;
  showtoolbar?: boolean;
  showsheetbar?: boolean;
}

// Always use a primitive for Luckysheet cell v (never an object, or it shows [object Object])
function toCellValue(val: unknown): string | number {
  if (val === undefined || val === null) return "";
  if (typeof val === "string" || typeof val === "number") return val;
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// Build Luckysheet celldata from headers + rows
function buildSheetData(
  headers: string[],
  rows: Record<string, any>[]
): LuckysheetSheet {
  const celldata: LuckysheetCellValue[] = [];
  const colCount = Math.max(headers.length, 1);
  const rowCount = Math.max(1, rows.length + 1); // +1 for header row

  // Header row (row 0)
  headers.forEach((h, c) => {
    celldata.push({
      r: 0,
      c,
      v: toCellValue(h),
    });
  });

  // Data rows
  rows.forEach((row, r) => {
    headers.forEach((h, c) => {
      const val = row?.[h];
      if (val !== undefined && val !== null && val !== "") {
        celldata.push({
          r: r + 1,
          c,
          v: toCellValue(val),
        });
      }
    });
  });

  return {
    name: "Sheet1",
    index: 0,
    status: 1,
    order: 0,
    row: rowCount + 20,
    column: Math.max(colCount + 5, 18),
    celldata,
    config: {},
  };
}

// Luckysheet cells can be primitives or objects like { v, m, ct } - always get display value
function cellToValue(cell: unknown): string | number {
  if (cell == null) return "";
  if (typeof cell === "object" && cell !== null && "v" in (cell as object)) {
    const v = (cell as { v?: unknown; m?: unknown }).v;
    if (v !== undefined && v !== null) return typeof v === "object" ? String(v) : (v as string | number);
    const m = (cell as { m?: unknown }).m;
    if (m !== undefined && m !== null) return typeof m === "object" ? String(m) : (m as string | number);
  }
  if (typeof cell === "object") return String(cell);
  return cell as string | number;
}

// Extract headers and rows from Luckysheet sheet data (cells may be objects).
// Use "Column N" for empty headers so we never drop columns (e.g. value in H2 when H1 is empty).
function sheetDataToHeadersRows(
  data: (string | number | null | Record<string, unknown>)[][] | undefined
): { headers: string[]; rows: Record<string, any>[] } {
  if (!data || data.length === 0) {
    return { headers: ["Column 1"], rows: [] };
  }
  const rawHeaderRow = data[0] || [];
  const numCols = rawHeaderRow.length;
  const headers = rawHeaderRow.map((c, i) => {
    const label = String(cellToValue(c)).trim();
    return label || `Column ${i + 1}`;
  });
  const safeHeaders = headers.length ? headers : ["Column 1"];
  const rows = data.slice(1).map((row) => {
    const obj: Record<string, any> = {};
    safeHeaders.forEach((h, i) => {
      obj[h] = cellToValue(row?.[i]);
    });
    return obj;
  });
  return { headers: safeHeaders, rows };
}

const LUCKYSHEET_CONTAINER_ID = "luckysheet-container";

// Build 2D grid from Luckysheet using getCellValue - gets LIVE edited values (per-cell try/catch so one bad cell doesn't break save)
function buildGridFromCells(
  luckysheet: NonNullable<typeof window.luckysheet>,
  maxRows: number,
  maxCols: number
): (string | number | null)[][] {
  const grid: (string | number | null)[][] = [];
  const getVal = luckysheet.getCellValue;
  if (typeof getVal !== "function") return grid;
  for (let r = 0; r < maxRows; r++) {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < maxCols; c++) {
      try {
        const val = getVal.call(luckysheet, r, c, { type: "m" });
        if (val === undefined || val === null) row.push(null);
        else if (typeof val === "object") row.push(JSON.stringify(val));
        else row.push(val as string | number);
      } catch {
        row.push(null);
      }
    }
    grid.push(row);
  }
  return grid;
}

// Trim trailing empty rows/cols so we don't save a huge grid
function trimGrid(
  grid: (string | number | null | Record<string, unknown>)[][]
): (string | number | null | Record<string, unknown>)[][] {
  const hasContent = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
  let lastRow = 0;
  let lastCol = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      const cell = grid[r][c];
      const val = typeof cell === "object" && cell !== null && "v" in cell ? (cell as { v?: unknown }).v : cell;
      if (hasContent(val)) {
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    }
  }
  const rows = grid.slice(0, lastRow + 1);
  return rows.map((row) => row.slice(0, lastCol + 1));
}

function ExcelEditContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useCurrentUser();
  const fileId = searchParams.get("id");

  const [file, setFile] = useState<ExcelFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [sheetLoadFailed, setSheetLoadFailed] = useState(false);
  const [sheetInitialized, setSheetInitialized] = useState(false);

  const initialDataRef = useRef<{ headers: string[]; rows: Record<string, any>[] } | null>(null);
  const luckysheetInitializedRef = useRef(false);
  const scriptsLoadedRef = useRef(false);

  useEffect(() => {
    if (!fileId) {
      const dashboardPath =
        user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard";
      router.push(dashboardPath);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/api/excel/${fileId}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("Failed to fetch file");
        }
        const data = await response.json();
        if (cancelled) return;
        if (!data.file) throw new Error("File data not found in response");
        const fileData = data.file as ExcelFile;
        const rowsRaw = Array.isArray(fileData.rows) ? fileData.rows : [];
        let headers: string[] = Array.isArray(fileData.headers)
          ? fileData.headers.map((h) => String(h ?? "").trim()).filter(Boolean)
          : [];
        if (headers.length === 0 && rowsRaw.length > 0) {
          const firstRow = rowsRaw[0];
          if (Array.isArray(firstRow)) {
            headers = Array.from({ length: firstRow.length }, (_, i) => `Column ${i + 1}`);
          } else if (firstRow && typeof firstRow === "object") {
            headers = Object.keys(firstRow);
          }
        }
        if (headers.length === 0) headers = ["Column 1"];
        setFile(fileData);
        initialDataRef.current = { headers, rows: JSON.parse(JSON.stringify(rowsRaw)) };
        setError("");
        if (!cancelled) tryInitLuckysheet();
      } catch (err) {
        if (!cancelled) {
          console.error("Error fetching file:", err);
          setError(err instanceof Error ? err.message : "Failed to load file");
          setFile(null);
          initialDataRef.current = null;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [fileId, user]);

  const tryInitLuckysheet = useCallback(() => {
    if (!scriptReady || luckysheetInitializedRef.current) return;
    const data = initialDataRef.current;
    if (!data) return;

    const win = typeof window !== "undefined" ? window : null;
    if (!win?.luckysheet?.create) return;

    // Destroy previous instance if any
    try {
      win.luckysheet.destroy();
    } catch (_) {}

    luckysheetInitializedRef.current = true;
    const sheet = buildSheetData(data.headers, data.rows);

    const opts = {
      container: LUCKYSHEET_CONTAINER_ID,
      title: file?.name ?? "Spreadsheet",
      lang: "en",
      showinfobar: true,
      showtoolbar: true,
      showsheetbar: true,
      data: [sheet],
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          win.luckysheet.create(opts);
          setSheetInitialized(true);
        } catch (err) {
          console.error("Luckysheet create error:", err);
          luckysheetInitializedRef.current = false;
        }
      });
    });
  }, [scriptReady, file?.name]);

  useEffect(() => {
    tryInitLuckysheet();
  }, [tryInitLuckysheet]);

  // When script loads and we already have data
  useEffect(() => {
    if (scriptReady && initialDataRef.current && !luckysheetInitializedRef.current) {
      tryInitLuckysheet();
    }
  }, [scriptReady, tryInitLuckysheet]);

  // If we have file data but sheet still not ready after a while, show fallback
  useEffect(() => {
    if (!file || !initialDataRef.current || scriptReady) return;
    const t = setTimeout(() => setSheetLoadFailed(true), 10000);
    return () => clearTimeout(t);
  }, [file, scriptReady]);

  const saveFile = async (showMessage = false) => {
    if (!file) return;
    const win = typeof window !== "undefined" ? window : null;
    if (!win?.luckysheet) {
      setError("Spreadsheet not ready. Wait for it to load.");
      return;
    }

    setError("");
    // Commit current cell: when user clicks Save without clicking elsewhere, the value is still in the formula bar.
    // Find Luckysheet's formula bar / cell editor, focus then blur it so the value is written to the sheet, then wait.
    if (typeof document !== "undefined") {
      const container = document.getElementById(LUCKYSHEET_CONTAINER_ID);
      const inContainer = container
        ? Array.from(container.querySelectorAll<HTMLElement>("input, textarea, [contenteditable=\"true\"]"))
        : [];
      const byClass = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[class*=\"luckysheet\"] input, [class*=\"luckysheet\"] textarea, [class*=\"luckysheet\"] [contenteditable=\"true\"]"
        )
      );
      const allEditors = [...new Set([...inContainer, ...byClass])];
      for (const el of allEditors) {
        try {
          el?.focus?.();
          el?.blur?.();
        } catch (_) {}
      }
      const active = document.activeElement as HTMLElement | null;
      if (active?.blur) active.blur();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 280));
    }

    const ls = win.luckysheet;
    let grid: (string | number | null | Record<string, unknown>)[][] | null = null;

    const sheets = ls.getAllSheets();
    const first = sheets?.[0];
    const maxRows = Math.min(Math.max(first?.row ?? 80, 40), 150);
    const maxCols = Math.min(Math.max(first?.column ?? 20, 15), 40);

    // 1) Prefer getCellValue so we get LIVE edits (e.g. "yuy" in D1). .data is often stale.
    if (typeof ls.getCellValue === "function") {
      const fromCells = buildGridFromCells(ls, maxRows, maxCols);
      if (fromCells.length > 0) {
        grid = fromCells as (string | number | null | Record<string, unknown>)[][];
      }
    }

    // 2) Fallback: .data from luckysheetfile (internal ref) or getAllSheets()
    if (!grid || grid.length === 0) {
      let fromData = Array.isArray(win.luckysheetfile?.[0]?.data)
        ? (win.luckysheetfile[0].data as (string | number | null | Record<string, unknown>)[][])
        : first?.data;
      if (!fromData && first?.celldata?.length && ls.transToData) {
        try {
          fromData = ls.transToData(first.celldata) as (string | number | null | Record<string, unknown>)[][];
        } catch (_) {}
      }
      if (fromData && fromData.length > 0) {
        grid = fromData;
      }
    }

    if (!grid || grid.length === 0) {
      setError("No sheet data to save. Try editing a cell first.");
      return;
    }

    try {
      let trimmed: (string | number | null | Record<string, unknown>)[][];
      try {
        trimmed = trimGrid(grid);
      } catch {
        trimmed = grid;
      }
      const { headers, rows } = sheetDataToHeadersRows(trimmed);

      setSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/excel/${file.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, headers, rows }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data?.message as string) || `Save failed (${res.status})`;
        setError(msg);
        return;
      }
      if (showMessage) {
        setSuccess("Saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    if (!file) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/excel/${file.id}/download`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      setError("Failed to download");
    }
  };

  // Cleanup on unmount or file change
  useEffect(() => {
    luckysheetInitializedRef.current = false;
    setSheetInitialized(false);
    setSheetLoadFailed(false);
    return () => {
      try {
        window.luckysheet?.destroy();
      } catch (_) {}
    };
  }, [fileId]);

  // Lock body scroll so clicking cells doesn't move the whole page
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevHeight = document.body.style.height;
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.height = prevHeight;
    };
  }, []);

  // Inject Luckysheet CSS into head (client-only) - must run before any conditional return
  useEffect(() => {
    const urls = [
      "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/css/pluginsCss.css",
      "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/pluginsCss.css",
      "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/css/luckysheet.css",
      "https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/assets/iconfont/iconfont.css",
    ];
    const links: HTMLLinkElement[] = [];
    urls.forEach((href) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      links.push(link);
    });
    const style = document.createElement("style");
    style.textContent = `
      /* Column header filter/dropdown: show filter symbol when icon font fails */
      #luckysheet-container [class*="cols-h"][class*="c"] > div:last-child::before,
      #luckysheet-container [class*="luckysheet-cols-h"] [class*="btn"]::before,
      #luckysheet-container .luckysheet-cols-h-c-btn::before {
        content: "\\25BC";
        font-size: 10px;
        line-height: 1;
        opacity: 0.9;
      }
      #luckysheet-container [class*="cols-h"] [class*="btn"]:empty::before,
      #luckysheet-container .luckysheet-cols-h-c-btn:empty::before {
        content: "\\25BC";
        font-size: 10px;
      }
    `;
    document.head.appendChild(style);
    return () => {
      links.forEach((l) => l.remove());
      style.remove();
    };
  }, []);

  // Load Luckysheet scripts in strict order (jQuery → plugin → luckysheet) when we have file data
  useEffect(() => {
    if (!file) return;
    if (typeof window !== "undefined" && window.luckysheet) {
      setTimeout(() => setScriptReady(true), 0);
      return;
    }
    if (scriptsLoadedRef.current) return;
    scriptsLoadedRef.current = true;

    function loadScripts(index: number) {
      if (index >= LUCKYSHEET_SCRIPTS.length) {
        setTimeout(() => setScriptReady(true), 0);
        return;
      }
      const src = LUCKYSHEET_SCRIPTS[index];
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => loadScripts(index + 1);
      script.onerror = () => {
        console.error("Luckysheet script failed to load:", src);
        setScriptReady(true); // allow retry / show UI
      };
      document.body.appendChild(script);
    }
    loadScripts(0);
  }, [file]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading file...</p>
        </div>
      </div>
    );
  }

  if (!file || !initialDataRef.current) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || "File not found"}</p>
          <Link
            href={
              user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"
            }
            className="text-cyan-400 hover:text-cyan-300"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-slate-950 flex flex-col overflow-hidden"
      style={{ height: "100vh" }}
    >
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm flex-shrink-0 z-20">
        <div className="max-w-full mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link
              href={
                user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"
              }
              className="text-sm text-slate-400 hover:text-slate-300 transition"
            >
              ← Back
            </Link>
            <h1 className="text-lg font-semibold text-slate-100 truncate max-w-[200px] sm:max-w-none">
              {file.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-slate-400">Saving...</span>}
            {success && <span className="text-xs text-green-400">{success}</span>}
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={() => saveFile(true)}
              disabled={saving}
              className="px-4 py-2 bg-cyan-500 text-white text-sm font-medium rounded-lg hover:bg-cyan-600 disabled:opacity-60"
            >
              Save
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-slate-700 text-slate-100 text-sm font-medium rounded-lg hover:bg-slate-600"
            >
              Download .xlsx
            </button>
          </div>
        </div>
      </header>

      {/* Full-page Luckysheet - fixed height so layout never jumps on cell click */}
      <main
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ height: "calc(100vh - 57px)" }}
      >
        {sheetLoadFailed && !sheetInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-10 p-4">
            <div className="text-center max-w-md">
              <p className="text-slate-300 mb-2">Spreadsheet is taking a moment to load.</p>
              <p className="text-slate-400 text-sm mb-4">If nothing appears, try opening the edit link in a new tab.</p>
              <Link
                href={`/excel-edit?id=${fileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600"
              >
                Open in new tab
              </Link>
            </div>
          </div>
        )}
        <div
          id={LUCKYSHEET_CONTAINER_ID}
          className="w-full h-full"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            height: "100%",
            contain: "layout style",
            isolation: "isolate",
            overflow: "hidden",
          }}
        />
      </main>
    </div>
  );
}

export default function ExcelEditPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400" />
        </div>
      }
    >
      <ExcelEditContent />
    </Suspense>
  );
}
