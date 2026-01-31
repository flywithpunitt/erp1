"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ExcelFile {
  id: string;
  name: string;
  headers: string[];
  rows: Record<string, any>[];
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
  const [editedData, setEditedData] = useState<{ headers: string[]; rows: Record<string, any>[] } | null>(null);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!fileId) {
      const dashboardPath = user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard";
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

  const handleCellChange = (rowIndex: number, header: string, value: string) => {
    if (!editedData) return;

    const newRows = [...editedData.rows];
    if (!newRows[rowIndex]) {
      newRows[rowIndex] = {};
    }
    newRows[rowIndex] = { ...newRows[rowIndex], [header]: value };

    setEditedData({ ...editedData, rows: newRows });

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    const timeout = setTimeout(() => {
      saveFile(false);
    }, 2000);

    setSaveTimeout(timeout);
  };

  const handleHeaderChange = (oldHeader: string, newHeader: string) => {
    if (!editedData || !newHeader.trim()) return;

    const headerIndex = editedData.headers.indexOf(oldHeader);
    if (headerIndex === -1) return;

    const newHeaders = [...editedData.headers];
    newHeaders[headerIndex] = newHeader.trim();

    const newRows = editedData.rows.map((row) => {
      const newRow = { ...row };
      if (oldHeader !== newHeader.trim()) {
        newRow[newHeader.trim()] = row[oldHeader] || "";
        delete newRow[oldHeader];
      }
      return newRow;
    });

    setEditedData({ headers: newHeaders, rows: newRows });
  };

  const handleAddRow = () => {
    if (!editedData) return;

    const newRow: Record<string, any> = {};
    editedData.headers.forEach((header) => {
      newRow[header] = "";
    });

    setEditedData({
      ...editedData,
      rows: [...editedData.rows, newRow],
    });
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!editedData) return;

    const newRows = editedData.rows.filter((_, i) => i !== rowIndex);
    setEditedData({ ...editedData, rows: newRows });
  };

  const handleAddColumn = () => {
    if (!editedData) return;

    const newHeader = `Column ${editedData.headers.length + 1}`;
    const newHeaders = [...editedData.headers, newHeader];
    const newRows = editedData.rows.map((row) => ({
      ...row,
      [newHeader]: "",
    }));

    setEditedData({ headers: newHeaders, rows: newRows });
  };

  const handleDeleteColumn = (header: string) => {
    if (!editedData || editedData.headers.length <= 1) return;

    const newHeaders = editedData.headers.filter((h) => h !== header);
    const newRows = editedData.rows.map((row) => {
      const newRow = { ...row };
      delete newRow[header];
      return newRow;
    });

    setEditedData({ headers: newHeaders, rows: newRows });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
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
            href={user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"}
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
      <header className="border-b border-slate-800 px-4 sm:px-8 py-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link
              href={user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"}
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 mb-2 transition"
            >
              ← Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              {file.name}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="text-sm text-slate-400">Saving...</span>}
            {success && <span className="text-sm text-green-400">{success}</span>}
            {error && <span className="text-sm text-red-400">{error}</span>}
            <button
              onClick={() => saveFile(true)}
              disabled={saving}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-500 text-white rounded-lg font-medium hover:from-cyan-600 hover:to-indigo-600 transition disabled:opacity-50"
            >
              💾 Save
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        <div className="mb-4 flex gap-3">
          <button
            onClick={handleAddRow}
            className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg font-medium hover:bg-slate-700 transition"
          >
            ➕ Add Row
          </button>
          <button
            onClick={handleAddColumn}
            className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg font-medium hover:bg-slate-700 transition"
          >
            ➕ Add Column
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800">
                <tr>
                  {editedData.headers.map((header, index) => (
                    <th key={index} className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={header}
                          onChange={(e) => handleHeaderChange(header, e.target.value)}
                          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 min-w-[120px]"
                        />
                        {editedData.headers.length > 1 && (
                          <button
                            onClick={() => handleDeleteColumn(header)}
                            className="text-red-400 hover:text-red-300 text-xs"
                            title="Delete column"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-slate-400 text-sm font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {editedData.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={editedData.headers.length + 1}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      No rows yet. Click "Add Row" to get started.
                    </td>
                  </tr>
                ) : (
                  editedData.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-slate-800/50 transition">
                      {editedData.headers.map((header) => (
                        <td key={header} className="px-4 py-2">
                          <input
                            type="text"
                            value={row[header] || ""}
                            onChange={(e) => handleCellChange(rowIndex, header, e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleDeleteRow(rowIndex)}
                          className="text-red-400 hover:text-red-300 text-sm"
                          title="Delete row"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
            <p className="text-slate-400">Loading...</p>
          </div>
        </div>
      }
    >
      <ExcelEditContent />
    </Suspense>
  );
}
