"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsTabs } from "../settings-tabs";

type RoleRow = {
  id: number;
  name: string;
};

type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  permission_level: "super_admin" | "admin" | "user";
  role_id: number | null;
  role_name: string | null;
  is_disabled: 0 | 1;
  created_at: string;
  updated_at: string;
};

function coerceRoles(value: unknown): RoleRow[] {
  if (!Array.isArray(value)) return [];
  const out: RoleRow[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as { id?: unknown; name?: unknown };
    if (typeof r.id === "number" && typeof r.name === "string") {
      out.push({ id: r.id, name: r.name });
    }
  }
  return out;
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function UsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    permissionLevel: "user" as "user" | "admin" | "super_admin",
    roleId: "",
    initialPassword: "",
  });

  const roleOptions = useMemo(
    () => [{ id: 0, name: "（不设置）" }, ...roles],
    [roles],
  );

  async function load() {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/roles", { cache: "no-store" }),
      ]);
      const usersJson = await usersRes.json();
      const rolesJson = await rolesRes.json();
      setUsers(usersJson.users ?? []);
      setRoles(coerceRoles(rolesJson.roles));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    const payload = {
      username: form.username,
      displayName: form.displayName || undefined,
      initialPassword: form.initialPassword,
      permissionLevel: form.permissionLevel,
      roleId: form.roleId ? String(form.roleId) : null,
    };

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "创建失败");
      return;
    }

    alert(`已创建用户：${form.username}\n初始密码：${form.initialPassword}`);
    setForm((f) => ({ ...f, username: "", displayName: "", initialPassword: "" }));
    await load();
  }

  async function patchUser(id: number, body: unknown) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "操作失败");
      return false;
    }
    await load();
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">配置管理</div>
          <div className="mt-1 text-sm text-muted">管理员/超级管理员可见</div>
        </div>
        <SettingsTabs />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">新增用户</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="用户名"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <input
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="显示名（可选）"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <select
            value={form.permissionLevel}
            onChange={(e) =>
              setForm((f) => ({ ...f, permissionLevel: e.target.value as UserRow["permission_level"] }))
            }
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          >
            <option value="user">使用者</option>
            <option value="admin">管理员</option>
            <option value="super_admin">超级管理员</option>
          </select>
          <select
            value={form.roleId}
            onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          >
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id === 0 ? "" : String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              value={form.initialPassword}
              onChange={(e) => setForm((f) => ({ ...f, initialPassword: e.target.value }))}
              placeholder="初始密码"
              className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
              type="password"
            />
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
              title="生成"
              onClick={() => setForm((f) => ({ ...f, initialPassword: randomPassword() }))}
            >
              ↻
            </button>
            <button
              type="button"
              disabled={!form.username || !form.initialPassword || loading}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
              onClick={createUser}
            >
              创建
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">用户列表</div>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
            onClick={load}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 bg-surface-2 px-3 py-2 text-xs text-muted">
            <div>ID</div>
            <div>用户名</div>
            <div>显示名</div>
            <div>权限</div>
            <div>角色</div>
            <div>状态</div>
            <div className="text-right">操作</div>
          </div>
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="grid grid-cols-7 items-center px-3 py-2 text-sm">
                <div className="text-muted">{u.id}</div>
                <div className="truncate">{u.username}</div>
                <div className="truncate text-muted">{u.display_name ?? "—"}</div>
                <div>
                  <select
                    value={u.permission_level}
                    onChange={(e) =>
                      patchUser(u.id, {
                        permissionLevel: e.target.value as UserRow["permission_level"],
                      })
                    }
                    className="h-8 w-full rounded-lg border border-border bg-surface-2 px-2 text-xs outline-none"
                    title="切换权限"
                  >
                    <option value="user">使用者</option>
                    <option value="admin">管理员</option>
                    <option value="super_admin">超级管理员</option>
                  </select>
                </div>
                <div>
                  <select
                    value={u.role_id ? String(u.role_id) : ""}
                    onChange={(e) => patchUser(u.id, { roleId: e.target.value || null })}
                    className="h-8 w-full rounded-lg border border-border bg-surface-2 px-2 text-xs outline-none"
                    title="切换角色"
                  >
                    {roleOptions.map((r) => (
                      <option key={r.id} value={r.id === 0 ? "" : String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-muted">{u.is_disabled ? "已禁用" : "正常"}</div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                    title={u.is_disabled ? "恢复" : "禁用"}
                    onClick={() => patchUser(u.id, { isDisabled: u.is_disabled ? false : true })}
                  >
                    {u.is_disabled ? "✓" : "⦸"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                    title="重置密码"
                    onClick={async () => {
                      const pwd = randomPassword();
                      const ok = await patchUser(u.id, { resetPassword: pwd });
                      if (ok) alert(`已重置密码：${u.username}\n新密码：${pwd}`);
                    }}
                  >
                    🔑
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                    title="软删除"
                    onClick={() => patchUser(u.id, { softDelete: true })}
                  >
                    ⌫
                  </button>
                </div>
              </div>
            ))}
            {users.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted">暂无数据</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
