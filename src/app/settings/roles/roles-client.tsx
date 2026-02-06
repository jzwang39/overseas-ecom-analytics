"use client";

import { useEffect, useMemo, useState } from "react";
import { MENU_GROUPS } from "@/lib/menu/config";
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
  const allMenuItems = useMemo(
    () => MENU_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label }))),
    [],
  );

  const [form, setForm] = useState({
    name: "",
    description: "",
    menuKeys: new Set<string>(),
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

  function toggleKey(key: string) {
    setForm((f) => {
      const next = new Set(f.menuKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, menuKeys: next };
    });
  }

  async function createRole() {
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description || undefined,
        menuKeys: Array.from(form.menuKeys),
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "创建失败");
      return;
    }
    setForm({ name: "", description: "", menuKeys: new Set() });
    await load();
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
          <div className="mt-1 text-sm text-muted">角色菜单组配置（影响左侧菜单可见性）</div>
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
            disabled={!form.name || form.menuKeys.size === 0}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
            onClick={createRole}
          >
            创建
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-3 bg-surface-2 px-3 py-2 text-xs text-muted">
            <div>模块</div>
            <div>菜单</div>
            <div className="text-right">选择</div>
          </div>
          <div className="divide-y divide-border">
            {allMenuItems.map((it) => (
              <div key={it.key} className="grid grid-cols-3 items-center px-3 py-2 text-sm">
                <div className="text-muted">{it.group}</div>
                <div className="truncate">{it.label}</div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className={[
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg border",
                      form.menuKeys.has(it.key)
                        ? "border-border bg-primary text-foreground"
                        : "border-border bg-surface hover:bg-surface-2 text-muted",
                    ].join(" ")}
                    title={form.menuKeys.has(it.key) ? "已选" : "未选"}
                    onClick={() => toggleKey(it.key)}
                  >
                    ✓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
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
              return (
                <div key={r.id} className="grid grid-cols-4 items-center px-3 py-2 text-sm">
                  <div className="text-muted">{r.id}</div>
                  <div className="truncate">{r.name}</div>
                  <div className="text-muted">{keys.length}</div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                      title="编辑菜单 JSON"
                      onClick={async () => {
                        const text = prompt("请输入菜单 key 的 JSON 数组", JSON.stringify(keys, null, 2));
                        if (!text) return;
                        let next: unknown;
                        try {
                          next = JSON.parse(text);
                        } catch {
                          alert("JSON 格式错误");
                          return;
                        }
                        if (!Array.isArray(next) || next.some((v) => typeof v !== "string")) {
                          alert("必须是字符串数组");
                          return;
                        }
                        await patchRole(r.id, { menuKeys: next });
                      }}
                    >
                      ✎
                    </button>
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
  );
}

