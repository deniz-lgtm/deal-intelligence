"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { UserRow } from "@/lib/db";

interface Props {
  initialUsers: UserRow[];
  allPermissions: string[];
  currentUserId: string;
}

export default function AdminUsersTable({
  initialUsers,
  allPermissions,
  currentUserId,
}: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function patchUser(id: string, body: { role?: string; permissions?: string[]; disabled?: boolean }) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      setUsers((prev) => prev.map((u) => (u.id === id ? (json.data as UserRow) : u)));
      toast.success("Updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  function togglePermission(user: UserRow, perm: string) {
    const has = user.permissions?.includes(perm);
    const next = has
      ? user.permissions.filter((p) => p !== perm)
      : [...(user.permissions ?? []), perm];
    patchUser(user.id, { permissions: next });
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3">User</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Role</th>
            <th className="text-left px-4 py-3">Permissions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {users.map((user) => {
            const isPending = pendingId === user.id;
            const isSelf = user.id === currentUserId;
            return (
              <tr key={user.id} className="hover:bg-neutral-900/60">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-neutral-100">
                    {user.name || user.email}
                    {isSelf && (
                      <span className="ml-2 text-xs text-indigo-400">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">{user.email}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  {isSelf ? (
                    <span className="text-xs text-neutral-500">—</span>
                  ) : (
                    <button
                      disabled={isPending}
                      onClick={() => patchUser(user.id, { disabled: !user.disabled_at })}
                      className={`text-xs px-2 py-1 rounded border transition ${
                        user.disabled_at
                          ? "border-rose-500/60 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                          : "border-emerald-500/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                      } disabled:opacity-50`}
                    >
                      {user.disabled_at ? "Disabled" : "Active"}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <select
                    value={user.role}
                    disabled={isPending}
                    onChange={(e) => patchUser(user.id, { role: e.target.value })}
                    className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-2">
                    {allPermissions.map((perm) => {
                      const checked = user.permissions?.includes(perm) ?? false;
                      return (
                        <label
                          key={perm}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer transition ${
                            checked
                              ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-200"
                              : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                          } ${isPending ? "opacity-50 pointer-events-none" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="accent-indigo-500"
                            checked={checked}
                            onChange={() => togglePermission(user, perm)}
                          />
                          {perm}
                        </label>
                      );
                    })}
                  </div>
                </td>
              </tr>
            );
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
