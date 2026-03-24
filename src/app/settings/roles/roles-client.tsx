"use client";

import { useEffect, useState } from "react";
import { SettingsTabs } from "../settings-tabs";

type RoleRow = {
  id: number;
  name: string;
  description: string | null;
  menu_keys: unknown;
};

function parseKeys(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

export function RolesClient() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles", { cache: "no-store" });
      const json = await res.json();
      setRoles(json.roles ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createRole() {
    const name = form.name.trim();
    if (!name) {
      alert("请填写角色名称");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: form.description.trim() || undefined,
          menuKeys: [],
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error ?? "创建失败");
        return;
      }
      setForm({ name: "", description: "" });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function patchRole(id: number, body: unknown) {
    const res = await fetch(`/api/admin/roles/${id}`, {
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
          <div className="mt-1 text-sm text-muted">角色管理</div>
        </div>
        <SettingsTabs />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">新增角色</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="角色名称"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="描述（可选）"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <button
            type="button"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
            onClick={createRole}
          >
            创建
          </button>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">角色列表</div>
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
            <div className="grid grid-cols-4 bg-surface-2 px-3 py-2 text-xs text-muted">
              <div>ID</div>
              <div>名称</div>
              <div>菜单数</div>
              <div className="text-right">操作</div>
            </div>
            <div className="divide-y divide-border">
              {roles.map((r) => {
                const keys = parseKeys(r.menu_keys);
                const isEditing = editingRoleId === r.id;
                return (
                  <div key={r.id} className="grid grid-cols-4 items-center px-3 py-2 text-sm">
                    <div className="text-muted">{r.id}</div>
                    <div className="min-w-0">
                      {isEditing ? (
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                          placeholder="角色名称"
                        />
                      ) : (
                        <div className="truncate">{r.name}</div>
                      )}
                    </div>
                    <div className="text-muted">{keys.length}</div>
                    <div className="flex justify-end gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={loading}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 disabled:opacity-50"
                            title="保存"
                            onClick={async () => {
                              const name = editingName.trim();
                              if (!name) {
                                alert("角色名称不能为空");
                                return;
                              }
                              const ok = await patchRole(r.id, { name });
                              if (ok) setEditingRoleId(null);
                            }}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 disabled:opacity-50"
                            title="取消"
                            onClick={() => setEditingRoleId(null)}
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                          title="修改名称"
                          onClick={() => {
                            setEditingRoleId(r.id);
                            setEditingName(r.name);
                          }}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                        title="软删除"
                        onClick={() => patchRole(r.id, { softDelete: true })}
                      >
                        ⌫
                      </button>
                    </div>
                  </div>
                );
              })}
              {roles.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted">暂无数据</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
