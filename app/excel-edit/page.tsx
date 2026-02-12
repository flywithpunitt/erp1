"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [formulaValue, setFormulaValue] = useState("");

  const hotTableRef = useRef<HotTable | null>(null);

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
      setFile(data.file);
      setEditedData({
        headers: [...data.file.headers],
        rows: JSON.parse(JSON.stringify(data.file.rows)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async (showMessage = false) => {
    if (!file || !editedData) return;

    try {
      setSaving(true);
      setError("");
      if (showMessage) setSuccess("");

      const response = await fetch(`${API_BASE_URL}/api/excel/${file.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: file.name,
          headers: editedData.headers,
          rows: editedData.rows,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to save");
      }

      if (showMessage) {
        setSuccess("File saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const scheduleAutoSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    const timeout = setTimeout(() => {
      saveFile(false);
    }, 2000);

    setSaveTimeout(timeout);
  };

  const handleCellChange = (rowIndex: number, header: string, value: string) => {
    if (!editedData) return;

    const newRows = [...editedData.rows];
    if (!newRows[rowIndex]) {
      newRows[rowIndex] = {};
    }
    newRows[rowIndex] = { ...newRows[rowIndex], [header]: value };

    setEditedData({ ...editedData, rows: newRows });
    scheduleAutoSave();
  };

  const handleHotChange = (changes: any[] | null, source: string) => {
    if (!changes || source === "loadData" || !editedData) return;

    changes.forEach(([rowIndex, prop, _oldValue, newValue]) => {
      const colIndex =
        typeof prop === "number"
          ? (prop as number)
          : editedData.headers.indexOf(prop as string);
      if (colIndex < 0) return;
      const header = editedData.headers[colIndex];
      handleCellChange(rowIndex, header, newValue ?? "");

      if (
        selectedCell &&
        selectedCell.row === rowIndex &&
        selectedCell.col === colIndex
      ) {
        setFormulaValue(newValue ?? "");
      }
    });
  };

  const handleAddRow = (afterRowIndex?: number) => {
    if (!editedData) return;

    const insertIndex =
      typeof afterRowIndex === "number"
        ? afterRowIndex + 1
        : editedData.rows.length;

    const newRow: Record<string, any> = {};
    editedData.headers.forEach((header) => {
      newRow[header] = "";
    });

    const newRows = [...editedData.rows];
    newRows.splice(insertIndex, 0, newRow);

    setEditedData({
      ...editedData,
      rows: newRows,
    });
    scheduleAutoSave();
  };

  const handleDeleteRow = (rowIndex?: number) => {
    if (!editedData) return;

    const targetRow =
      typeof rowIndex === "number"
        ? rowIndex
        : selectedCell
        ? selectedCell.row
        : null;

    if (targetRow === null || targetRow < 0 || targetRow >= editedData.rows.length) {
      return;
    }

    const newRows = editedData.rows.filter((_, i) => i !== targetRow);
    setEditedData({ ...editedData, rows: newRows });
    scheduleAutoSave();
  };

  const handleAddColumn = (afterColIndex?: number) => {
    if (!editedData) return;

    const insertIndex =
      typeof afterColIndex === "number"
        ? afterColIndex + 1
        : editedData.headers.length;

    const newHeader = `Column ${editedData.headers.length + 1}`;
    const newHeaders = [...editedData.headers];
    newHeaders.splice(insertIndex, 0, newHeader);

    const newRows = editedData.rows.map((row) => {
      const nextRow: Record<string, any> = {};
      newHeaders.forEach((header) => {
        if (header === newHeader) {
          nextRow[header] = "";
        } else {
          nextRow[header] = row[header] ?? "";
        }
      });
      return nextRow;
    });

    setEditedData({ headers: newHeaders, rows: newRows });
    scheduleAutoSave();
  };

  const applyClassToSelection = (options: {
    toggleClass?: string;
    alignClass?: "htLeft" | "htCenter" | "htRight";
  }) => {
    const hotInstance: Handsontable | undefined =
      hotTableRef.current?.hotInstance;

    if (!hotInstance) return;

    const selectedRange = hotInstance.getSelectedLast();
    if (!selectedRange) return;

    const [startRow, startCol, endRow, endCol] = selectedRange;

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const meta = hotInstance.getCellMeta(row, col);
        const classNames = new Set(
          (meta.className || "").split(" ").filter(Boolean)
        );

        if (options.toggleClass) {
          if (classNames.has(options.toggleClass)) {
            classNames.delete(options.toggleClass);
          } else {
            classNames.add(options.toggleClass);
          }
        }

        if (options.alignClass) {
          ["htLeft", "htCenter", "htRight", "htJustify"].forEach((cls) =>
            classNames.delete(cls)
          );
          classNames.add(options.alignClass);
        }

        const nextClassName = Array.from(classNames).join(" ");
        hotInstance.setCellMeta(row, col, "className", nextClassName || undefined);
      }
    }

    hotInstance.render();
  };

  const handleMergeCells = () => {
    const hotInstance: Handsontable | undefined =
      hotTableRef.current?.hotInstance;

    if (!hotInstance) return;

    const mergeCellsPlugin = hotInstance.getPlugin("mergeCells");
    const range = hotInstance.getSelectedRangeLast();

    if (!range) return;

    const { from, to } = range;
    mergeCellsPlugin.merge({
      row: from.row,
      col: from.col,
      rowspan: to.row - from.row + 1,
      colspan: to.col - from.col + 1,
    });

    hotInstance.render();
  };

  const handleDownload = () => {
    if (!file) return;
    window.location.href = `${API_BASE_URL}/api/excel/${file.id}/download`;
  };

  const handleAfterSelectionEnd = (
    row: number,
    column: number,
    _row2: number,
    _column2: number
  ) => {
    if (row < 0 || column < 0) return;

    setSelectedCell({ row, col: column });

    const hotInstance: Handsontable | undefined =
      hotTableRef.current?.hotInstance;
    const value = hotInstance?.getDataAtCell(row, column) ?? "";
    setFormulaValue(value ?? "");
  };

  const handleFormulaCommit = () => {
    if (!selectedCell) return;

    const hotInstance: Handsontable | undefined =
      hotTableRef.current?.hotInstance;

    if (!hotInstance) return;

    const { row, col } = selectedCell;
    hotInstance.setDataAtCell(row, col, formulaValue);
    hotInstance.render();
  };

  const tableData =
    editedData?.rows.map((row) =>
      editedData.headers.map((header) => row[header] ?? "")
    ) ?? [];

  const selectedCellLabel =
    selectedCell != null
      ? `${getColumnLetter(selectedCell.col)}${selectedCell.row + 1}`
      : "";

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
            className="text-cyan-400 hover:text-cyan-300 transition"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
            </div>
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
          <div className="overflow-auto max-h-[70vh]">
            <HotTable
              ref={hotTableRef}
              className="ht-excel-like"
              data={tableData}
              colHeaders={(index) => getColumnLetter(index)}
              rowHeaders
              stretchH="all"
              height="auto"
              width="100%"
              manualColumnResize
              manualRowResize
              contextMenu
              copyPaste
              licenseKey="non-commercial-and-evaluation"
              afterChange={handleHotChange}
              afterSelectionEnd={handleAfterSelectionEnd}
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
