"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import type { UserProfile } from "@/types/user";

interface UserWithStats extends UserProfile {
  fileCount?: number;
}

export default function UserListPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/users`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      const usersData = data.users || [];

      // Fetch file counts for each user
      const usersWithStats = await Promise.all(
        usersData.map(async (user: UserProfile) => {
          try {
            const filesRes = await fetch(`${API_BASE_URL}/api/excel/admin`, {
              credentials: "include",
            });
            if (filesRes.ok) {
              const filesData = await filesRes.json();
              const userFiles = filesData.files?.filter(
                (f: any) => f.owner?.id === user.id
              ) || [];
              return { ...user, fileCount: userFiles.length };
            }
          } catch (e) {
            // Ignore errors
          }
          return { ...user, fileCount: 0 };
        })
      );

      setUsers(usersWithStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, role: string) => {
    if (role !== "MANAGER") {
      return;
    }

    const confirmed = window.confirm("Are you sure you want to delete this manager?");
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete user");
      }

      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const adminCount = users.filter((u) => u.role === "ADMIN").length;
  const managerCount = users.filter((u) => u.role === "MANAGER").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 px-4 sm:px-8 py-6">
        <div className="max-w-7xl mx-auto">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 mb-4 transition"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
            User Directory
          </h1>
          <p className="text-slate-400 mt-2">Manage all Admin and Manager accounts</p>
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
            <p className="text-sm text-slate-400 mb-2">Total Users</p>
            <p className="text-3xl font-bold text-cyan-400">{users.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-2">Admins</p>
            <p className="text-3xl font-bold text-indigo-400">{adminCount}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-2">Managers</p>
            <p className="text-3xl font-bold text-purple-400">{managerCount}</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">All Users</h2>
              <p className="text-sm text-slate-400 mt-1">View and manage user accounts</p>
            </div>
            <Link
              href="/create-user"
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-500 text-white rounded-lg font-medium hover:from-cyan-600 hover:to-indigo-600 transition"
            >
              ➕ Create User
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p>No users found yet.</p>
              <Link
                href="/create-user"
                className="text-cyan-400 hover:text-cyan-300 mt-4 inline-block"
              >
                Create the first user
              </Link>
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
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Files
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-800/50 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-200">{user.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-300">{user.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === "ADMIN"
                              ? "bg-cyan-500/20 text-cyan-400"
                              : "bg-indigo-500/20 text-indigo-400"
                          }`}
                        >
                          {user.role === "ADMIN" ? "👑 Admin" : "📊 Manager"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-400">{user.fileCount || 0} files</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-400">
                          {user.createdAt
                            ? new Date(user.createdAt).toLocaleDateString()
                            : "N/A"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {user.role === "MANAGER" ? (
                          <button
                            onClick={() => handleDeleteUser(user.id, user.role)}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-300 border border-red-500/40 hover:bg-red-500/20 hover:text-red-100 transition-colors"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">Protected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
