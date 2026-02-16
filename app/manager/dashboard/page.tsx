"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SignOutButton from "@/components/SignOutButton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { API_BASE_URL } from "@/lib/config";
import { Pencil, Download, Copy, Trash2 } from "lucide-react";

interface ExcelFile {
  id: string;
  name: string;
  headers: string[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function ManagerDashboardPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const router = useRouter();
  const [files, setFiles] = useState<ExcelFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [template, setTemplate] = useState("blank");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/excel`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch files");
      }

      const data = await response.json();
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!fileName.trim()) {
      setError("Please enter a file name");
      return;
    }

    try {
      setCreating(true);
      setError("");

      const response = await fetch(`${API_BASE_URL}/api/excel/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ template, name: fileName }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create file");
      }

      const data = await response.json();
      router.push(`/excel-edit?id=${data.file.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (fileId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/excel/${fileId}/duplicate`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to duplicate file");
      }

      fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate file");
    }
  };

  const handleDelete = async (fileId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete "${fileName}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/excel/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete file");
      }

      fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file");
    }
  };

  const handleDownload = async (fileId: string, fileName: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/excel/${fileId}/download`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to download file");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download file");
    }
  };

  const templates = [
    { value: "blank", label: "Blank Spreadsheet" },
    { value: "vehicle", label: "Vehicle Register" },
    { value: "driver", label: "Driver Log" },
    { value: "expense", label: "Expense Tracker" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 px-4 sm:px-8 py-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              Manager Dashboard
            </h1>
            <p className="text-slate-400 mt-1">
              {userLoading ? "Loading..." : `Welcome, ${user?.name || "Manager"}`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="px-4 py-2 border border-slate-700 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition"
            >
              Home
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-2">Total Files</p>
            <p className="text-3xl font-bold text-cyan-400">{files.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-2">Total Rows</p>
            <p className="text-3xl font-bold text-indigo-400">
              {files.reduce((sum, f) => sum + f.rowCount, 0)}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-2">Last Updated</p>
            <p className="text-sm text-slate-300">
              {files.length > 0
                ? new Date(files[0].updatedAt).toLocaleDateString()
                : "Never"}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-indigo-500 text-white rounded-lg font-medium hover:from-cyan-600 hover:to-indigo-600 transition"
          >
            ➕ Create Excel
          </button>
          <Link
            href="/upload"
            className="px-6 py-3 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg font-medium hover:bg-slate-700 transition text-center"
          >
            📤 Upload Excel
          </Link>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-xl font-semibold text-slate-100">My Files</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p className="mb-4">No files yet. Create or upload your first Excel file!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Columns
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Rows
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Updated
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {files.map((file) => (
                    <tr key={file.id} className="hover:bg-slate-800/50 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-200">{file.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-400">{file.headers.length}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-400">{file.rowCount}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-400">
                          {new Date(file.updatedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
  <div className="flex items-center justify-end gap-3">
    
    <button
      onClick={() => router.push(`/excel-edit?id=${file.id}`)}
      className="text-cyan-400 hover:text-cyan-300 transition"
      title="Edit"
    >
      <Pencil size={18} />
    </button>

    <button
      onClick={() => handleDownload(file.id, file.name)}
      className="text-indigo-400 hover:text-indigo-300 transition"
      title="Download"
    >
      <Download size={18} />
    </button>

    <button
      onClick={() => handleDuplicate(file.id)}
      className="text-slate-400 hover:text-slate-300 transition"
      title="Duplicate"
    >
      <Copy size={18} />
    </button>

    <button
      onClick={() => handleDelete(file.id, file.name)}
      className="text-red-400 hover:text-red-300 transition"
      title="Delete"
    >
      <Trash2 size={18} />
    </button>

  </div>
</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold text-slate-100 mb-4">Create New Excel File</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">File Name</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="My Spreadsheet"
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Template</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {templates.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-500 text-white rounded-lg font-medium hover:from-cyan-600 hover:to-indigo-600 transition disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setFileName("");
                  setTemplate("blank");
                }}
                className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg font-medium hover:bg-slate-700 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
