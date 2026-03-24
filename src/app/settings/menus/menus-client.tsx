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

export function MenusClient() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [menuKeys, setMenuKeys] = useState<Set<string>>(new Set());

  const allMenuItems = useMemo(
    () => MENU_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label }))),
    [],
  );

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles", { cache: "no-store" });
      const json = await res.json();
      const nextRoles = (json.roles ?? []) as RoleRow[];
      setRoles(nextRoles);

      if (selectedRoleId == null) {
        const firstId = typeof nextRoles?.[0]?.id === "number" ? nextRoles[0].id : null;
        setSelectedRoleId(firstId);
      } else {
        const exists = nextRoles.some((r) => r.id === selectedRoleId);
        if (!exists) {
          const firstId = typeof nextRoles?.[0]?.id === "number" ? nextRoles[0].id : null;
          setSelectedRoleId(firstId);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (selectedRoleId == null) {
      setMenuKeys(new Set());
      return;
    }
    const role = roles.find((r) => r.id === selectedRoleId);
    setMenuKeys(new Set(role ? parseKeys(role.menu_keys) : []));
  }, [selectedRoleId, roles]);

  function toggleKey(key: string) {
    setMenuKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (selectedRoleId == null) return;
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/roles/${selectedRoleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuKeys: Array.from(menuKeys) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error ?? "保存失败");
        return;
      }
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">配置管理</div>
          <div className="mt-1 text-sm text-muted">菜单权限配置（按角色分配可见菜单）</div>
        </div>
        <SettingsTabs />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">菜单管理</div>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2 disabled:opacity-50"
            onClick={save}
            disabled={loading || selectedRoleId == null}
          >
            {loading ? "保存中…" : "保存"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <select
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
            value={selectedRoleId == null ? "" : String(selectedRoleId)}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedRoleId(v ? Number(v) : null);
            }}
          >
            <option value="">请选择角色</option>
            {roles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="flex items-center text-sm text-muted sm:col-span-2">
            {selectedRoleId == null ? "选择角色后配置可见菜单" : `已选择 ${menuKeys.size} 个菜单`}
          </div>
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
                    disabled={selectedRoleId == null}
                    className={[
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-50",
                      menuKeys.has(it.key)
                          ? "border-primary bg-surface text-primary"
                        : "border-border bg-surface hover:bg-surface-2 text-muted",
                    ].join(" ")}
                    title={menuKeys.has(it.key) ? "已选" : "未选"}
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
    </div>
  );
}
