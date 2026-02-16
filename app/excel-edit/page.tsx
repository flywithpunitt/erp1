"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { HotTable } from "@handsontable/react";
import type Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.min.css";

interface ExcelFile {
  id: string;
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

interface SelectedCell {
  row: number;
  col: number;
}

const getColumnLetter = (index: number): string => {
  let dividend = index + 1;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
};

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
  const [editedData, setEditedData] = useState<{
    headers: string[];
    rows: Record<string, any>[];
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [formulaValue, setFormulaValue] = useState("");

  const hotTableRef = useRef<any>(null);
  const lastSelectionRef = useRef<{ row: number; col: number } | null>(null);
  
  // Helper to get Handsontable instance from ref
  const getHotInstance = (): Handsontable | undefined => {
    const ref = hotTableRef.current;
    if (!ref) return undefined;
    // Access hotInstance with type assertion since TypeScript doesn't recognize it
    return (ref as any).hotInstance as Handsontable | undefined;
  };

  useEffect(() => {
    if (!fileId) {
      const dashboardPath =
        user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard";
      router.push(dashboardPath);
      return;
    }
    fetchFile();
  }, [fileId, user]);

  const fetchFile = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/excel/${fileId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch file");
      }

      const data = await response.json();

      if (!data.file) {
        throw new Error("File data not found in response");
      }

      const fileData = data.file as ExcelFile;

      // Rows can be empty, but must be an array
      const rowsRaw = Array.isArray(fileData.rows) ? fileData.rows : [];

      // Prefer stored headers; if missing/empty but rows exist, derive a stable header set
      let headers: string[] = Array.isArray(fileData.headers)
        ? fileData.headers.map((h) => String(h ?? "").trim()).filter(Boolean)
        : [];

      if (headers.length === 0 && rowsRaw.length > 0) {
        const firstRow: any = rowsRaw[0];
        if (Array.isArray(firstRow)) {
          headers = Array.from({ length: firstRow.length }, (_v, i) => `Column ${i + 1}`);
        } else if (firstRow && typeof firstRow === "object") {
          headers = Object.keys(firstRow);
        }
      }

      // If still no headers, create a single column so the grid isn't 0-width
      if (headers.length === 0) {
        headers = ["Column 1"];
      }

      setFile(fileData);
      setEditedData({
        headers,
        rows: JSON.parse(JSON.stringify(rowsRaw)),
      });

      setError(""); // Clear any previous errors
    } catch (err) {
      console.error("Error fetching file:", err);
      setError(err instanceof Error ? err.message : "Failed to load file");
      setFile(null);
      setEditedData(null);
    } finally {
      setLoading(false);
    }
  };

  // ✅ STEP 2 — Load data IMPERATIVELY
  useEffect(() => {
    if (!editedData) return;
    if (!hotTableRef.current) return;
  
    const hot = hotTableRef.current.hotInstance;
  
    // Build true Excel-like 2D grid
    const grid: any[][] = [];
  
    // Header row
    grid.push(editedData.headers);
  
    // Data rows
    editedData.rows.forEach((row) => {
      if (Array.isArray(row)) {
        grid.push(row);
      } else {
        grid.push(
          editedData.headers.map((h) => row?.[h] ?? "")
        );
      }
    });
  
    hot.loadData(grid);   // 🔥 THIS IS THE FIX
    hot.render();
  }, [editedData]);

  // ✅ STEP 5 — Save MUST read from Handsontable (not state)
  const saveFile = async (showMessage = false) => {
    if (!file) return;
    const hot = getHotInstance();
    if (!hot) return;

    const data = hot.getData();
    if (!data || data.length === 0) return;

    const headers = data[0];
    const rows = data.slice(1).map((row) => {
      const obj: Record<string, any> = {};
      headers.forEach((h: string, i: number) => {
        obj[h] = row[i];
      });
      return obj;
    });

    try {
      setSaving(true);
      await fetch(`${API_BASE_URL}/api/excel/${file.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, headers, rows }),
      });

      if (showMessage) {
        setSuccess("File saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError("Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleAfterSelectionEnd = useCallback(
    (row: number, col: number, row2: number, col2: number) => {
      // Store selection
      lastSelectionRef.current = { row, col };
      setSelectedCell({ row, col });
      
      // Update formula bar
      const hot = getHotInstance();
      if (hot) {
        const cellValue = hot.getDataAtCell(row, col);
        setFormulaValue(cellValue ?? "");
      }
    },
    []
  );

  const handleFormulaCommit = useCallback(() => {
    const hot = getHotInstance();
    if (!hot || !selectedCell) return;

    hot.setDataAtCell(selectedCell.row, selectedCell.col, formulaValue);
  }, [selectedCell, formulaValue]);

  const handleDownload = () => {
    if (!file) return;
    
    const hot = getHotInstance();
    if (!hot) return;

    const data = hot.getData();
    if (!data || data.length === 0) return;

    // Convert to CSV
    const csvContent = data
      .map((row) =>
        row.map((cell: any) => {
          const cellStr = String(cell ?? "");
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        })
        .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.name || "export"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const applyClassToSelection = useCallback(
    ({
      toggleClass,
      alignClass,
    }: {
      toggleClass?: string;
      alignClass?: string;
    }) => {
      const hot = getHotInstance();
      if (!hot) return;

      const selected = hot.getSelected();
      if (!selected || selected.length === 0) return;

      selected.forEach(([row1, col1, row2, col2]) => {
        const startRow = Math.min(row1, row2);
        const endRow = Math.max(row1, row2);
        const startCol = Math.min(col1, col2);
        const endCol = Math.max(col1, col2);

        for (let r = startRow; r <= endRow; r++) {
          for (let c = startCol; c <= endCol; c++) {
            const meta = hot.getCellMeta(r, c);
            const currentClasses = meta.className ? meta.className.split(" ") : [];

            if (toggleClass) {
              const idx = currentClasses.indexOf(toggleClass);
              if (idx >= 0) {
                currentClasses.splice(idx, 1);
              } else {
                currentClasses.push(toggleClass);
              }
            }

            if (alignClass) {
              const alignClasses = ["htLeft", "htCenter", "htRight"];
              const filtered = currentClasses.filter(
                (cls) => !alignClasses.includes(cls)
              );
              filtered.push(alignClass);
              hot.setCellMeta(r, c, "className", filtered.join(" "));
            } else {
              hot.setCellMeta(r, c, "className", currentClasses.join(" "));
            }
          }
        }
      });

      hot.render();
    },
    []
  );

  const handleMergeCells = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;

    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;

    const [row1, col1, row2, col2] = selected[0];
    const startRow = Math.min(row1, row2);
    const endRow = Math.max(row1, row2);
    const startCol = Math.min(col1, col2);
    const endCol = Math.max(col1, col2);

    const plugin = hot.getPlugin("mergeCells");
    if (plugin) {
      plugin.merge(startRow, startCol, endRow, endCol);
      hot.render();
    }
  }, []);

  const handleAddRow = useCallback((atRow?: number) => {
    const hot = getHotInstance();
    if (!hot) return;

    const targetRow = atRow ?? hot.countRows();
    hot.alter("insert_row_below", targetRow, 1);
  }, []);

  const handleAddColumn = useCallback((atCol?: number) => {
    const hot = getHotInstance();
    if (!hot) return;

    const targetCol = atCol ?? hot.countCols();
    hot.alter("insert_col_end", targetCol, 1);
  }, []);

  const handleDeleteRow = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;

    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;

    const [row1, , row2] = selected[0];
    const startRow = Math.min(row1, row2);
    const amount = Math.abs(row2 - row1) + 1;

    hot.alter("remove_row", startRow, amount);
  }, []);

  const handleDeleteColumn = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;

    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;

    const [, col1, , col2] = selected[0];
    const startCol = Math.min(col1, col2);
    const amount = Math.abs(col2 - col1) + 1;

    hot.alter("remove_col", startCol, amount);
  }, []);

  const handleUndo = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;
    const undoPlugin = hot.getPlugin("undoRedo");
    if (undoPlugin) {
      undoPlugin.undo();
    }
  }, []);

  const handleRedo = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;
    const undoPlugin = hot.getPlugin("undoRedo");
    if (undoPlugin) {
      undoPlugin.redo();
    }
  }, []);

  const handleClearCell = useCallback(() => {
    const hot = getHotInstance();
    if (!hot) return;

    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;

    selected.forEach(([row1, col1, row2, col2]) => {
      const startRow = Math.min(row1, row2);
      const endRow = Math.max(row1, row2);
      const startCol = Math.min(col1, col2);
      const endCol = Math.max(col1, col2);

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          hot.setDataAtCell(r, c, "");
        }
      }
    });
  }, []);

  const selectedCellLabel =
    selectedCell !== null
      ? `${getColumnLetter(selectedCell.col)}${selectedCell.row + 1}`
      : null;

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

  if (!file || !editedData) {
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
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Link
                href={
                  user?.role === "ADMIN"
                    ? "/admin/dashboard"
                    : "/manager/dashboard"
                }
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 mb-1 transition"
              >
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-50">
                {file.name}
              </h1>
            </div>
            <div className="flex items-center flex-wrap gap-3">
              {saving && (
                <span className="text-xs sm:text-sm text-slate-400">
                  Saving...
                </span>
              )}
              {success && (
                <span className="text-xs sm:text-sm text-green-400">
                  {success}
                </span>
              )}
              {error && (
                <span className="text-xs sm:text-sm text-red-400">{error}</span>
              )}
              <button
                onClick={() => saveFile(true)}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-md border border-cyan-500/60 bg-cyan-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-cyan-600 disabled:opacity-60"
              >
                Save
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Download
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
            <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 shadow-sm">
              <button
                type="button"
                onClick={() => applyClassToSelection({ toggleClass: "htBold" })}
                className="px-2.5 py-1.5 font-semibold text-slate-100 hover:bg-slate-800"
              >
                B
              </button>
              <button
                type="button"
                onClick={() =>
                  applyClassToSelection({ toggleClass: "htItalic" })
                }
                className="px-2.5 py-1.5 italic text-slate-100 hover:bg-slate-800"
              >
                I
              </button>
            </div>

            <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 shadow-sm">
              <button
                type="button"
                onClick={() =>
                  applyClassToSelection({ alignClass: "htLeft" })
                }
                className="px-2.5 py-1.5 text-slate-100 hover:bg-slate-800"
              >
                Align L
              </button>
              <button
                type="button"
                onClick={() =>
                  applyClassToSelection({ alignClass: "htCenter" })
                }
                className="px-2.5 py-1.5 text-slate-100 hover:bg-slate-800"
              >
                Align C
              </button>
              <button
                type="button"
                onClick={() =>
                  applyClassToSelection({ alignClass: "htRight" })
                }
                className="px-2.5 py-1.5 text-slate-100 hover:bg-slate-800"
              >
                Align R
              </button>
            </div>

            <button
              type="button"
              onClick={handleMergeCells}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-slate-100 hover:bg-slate-800 shadow-sm"
            >
              Merge Cells
            </button>

            <div className="inline-flex rounded-md border border-emerald-700 bg-emerald-900/60 shadow-sm">
              <button
                type="button"
                onClick={() =>
                  handleAddRow(selectedCell ? selectedCell.row : undefined)
                }
                className="px-2.5 py-1.5 text-emerald-50 hover:bg-emerald-800"
              >
                + Row
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAddColumn(selectedCell ? selectedCell.col : undefined)
                }
                className="px-2.5 py-1.5 text-emerald-50 hover:bg-emerald-800"
              >
                + Col
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRow()}
                className="px-2.5 py-1.5 text-red-100 hover:bg-red-900/70 border-l border-emerald-700"
              >
                Delete Row
              </button>
              <button
                type="button"
                onClick={() => handleDeleteColumn()}
                className="px-2.5 py-1.5 text-red-100 hover:bg-red-900/70 border-l border-emerald-700"
              >
                Delete Col
              </button>
            </div>

            <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 shadow-sm">
              <button
                type="button"
                onClick={handleUndo}
                className="px-2.5 py-1.5 text-slate-100 hover:bg-slate-800"
                title="Undo (Ctrl+Z)"
              >
                ↶ Undo
              </button>
              <button
                type="button"
                onClick={handleRedo}
                className="px-2.5 py-1.5 text-slate-100 hover:bg-slate-800 border-l border-slate-700"
                title="Redo (Ctrl+Y)"
              >
                ↷ Redo
              </button>
            </div>

            <button
              type="button"
              onClick={handleClearCell}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-slate-100 hover:bg-slate-800 shadow-sm"
              title="Clear selected cells"
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/80 px-3 py-2 shadow-sm">
          <span className="min-w-[3rem] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-center text-xs font-medium text-slate-300">
            {selectedCellLabel || "--"}
          </span>
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            placeholder="Formula bar"
            value={formulaValue}
            onChange={(e) => setFormulaValue(e.target.value)}
            onBlur={handleFormulaCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleFormulaCommit();
              }
            }}
          />
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="border-b border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
            Sheet1
          </div>
          <div
            className="overflow-auto max-h-[70vh] w-full"
            style={{ position: "relative", width: "100%" }}
          >
            <HotTable
              ref={hotTableRef}
              rowHeaders={true}
              colHeaders={true}
              stretchH="all"
              width="100%"
              height={600}
              manualColumnResize
              manualRowResize
              contextMenu
              copyPaste
              undo
              licenseKey="non-commercial-and-evaluation"
              afterSelectionEnd={handleAfterSelectionEnd}
              viewportRowRenderingOffset={50}
              viewportColumnRenderingOffset={20}
              columnWidth={100}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ExcelEditPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4" />
            <p className="text-slate-400">Loading...</p>
          </div>
        </div>
      }
    >
      <ExcelEditContent />
    </Suspense>
  );
}