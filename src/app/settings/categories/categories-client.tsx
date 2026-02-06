"use client";

import { useEffect, useState } from "react";
import { SettingsTabs } from "../settings-tabs";

type CategoryRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

async function readApiError(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json: unknown = await res.json().catch(() => ({}));
    if (json && typeof json === "object" && "error" in json) {
      const e = (json as { error?: unknown }).error;
      if (typeof e === "string" && e.trim()) return e;
    }
  }
  const text = await res.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) return `请求失败（${res.status}）`;
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

export function CategoriesClient() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/categories", { cache: "no-store" });
      if (!res.ok) {
        alert(await readApiError(res));
        setRows([]);
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      const list =
        json && typeof json === "object" && "categories" in json
          ? (json as { categories?: unknown }).categories
          : null;
      setRows(Array.isArray(list) ? (list as CategoryRow[]) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (pendingDeleteId == null) return;
    const t = window.setTimeout(() => setPendingDeleteId(null), 3000);
    return () => window.clearTimeout(t);
  }, [pendingDeleteId]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      alert(await readApiError(res));
      return;
    }
    setName("");
    await load();
  }

  async function patch(id: number, body: unknown) {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(await readApiError(res));
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
          <div className="mt-1 text-sm text-muted">类目配置（用于工作区“所属类目”下拉选项）</div>
        </div>
        <SettingsTabs />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">新增类目</div>
        <div className="mt-4 flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="类目名称"
            className="h-10 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <button
            type="button"
            disabled={!name.trim()}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
            onClick={create}
          >
            创建
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2"
            onClick={load}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">类目列表</div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-4 bg-surface-2 px-3 py-2 text-xs text-muted">
            <div>ID</div>
            <div>名称</div>
            <div>更新时间</div>
            <div className="text-right">操作</div>
          </div>
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-4 items-center px-3 py-2 text-sm">
                <div className="text-muted">{r.id}</div>
                <div className="min-w-0">
                  {editingId === r.id ? (
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      onKeyDown={async (e) => {
                        if (e.key !== "Enter") return;
                        const next = editingName.trim();
                        if (!next) return;
                        const ok = await patch(r.id, { name: next });
                        if (!ok) return;
                        setEditingId(null);
                        setEditingName("");
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="truncate">{r.name}</div>
                  )}
                </div>
                <div className="text-muted">{r.updated_at}</div>
                <div className="flex justify-end gap-2">
                  {editingId === r.id ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium hover:bg-primary-2 disabled:opacity-50"
                        disabled={!editingName.trim()}
                        onClick={async () => {
                          const next = editingName.trim();
                          if (!next) return;
                          const ok = await patch(r.id, { name: next });
                          if (!ok) return;
                          setEditingId(null);
                          setEditingName("");
                        }}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                        title="重命名"
                        onClick={() => {
                          setPendingDeleteId(null);
                          setEditingId(r.id);
                          setEditingName(r.name);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                        title="删除"
                        onClick={async () => {
                          if (pendingDeleteId !== r.id) {
                            setPendingDeleteId(r.id);
                            return;
                          }
                          setPendingDeleteId(null);
                          await patch(r.id, { softDelete: true });
                        }}
                      >
                        {pendingDeleteId === r.id ? "确认删除" : "删除"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 ? <div className="px-3 py-6 text-sm text-muted">暂无数据</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
