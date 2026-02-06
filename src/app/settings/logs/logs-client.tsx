"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsTabs } from "../settings-tabs";

type LogRow = {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  created_at: string;
  actor_username: string | null;
};

export function LogsClient() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ action: "", actor: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.action) qs.set("action", filters.action);
      if (filters.actor) qs.set("actor", filters.actor);
      const res = await fetch(`/api/admin/logs?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      setLogs(json.logs ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters.action, filters.actor]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">配置管理</div>
          <div className="mt-1 text-sm text-muted">所有关键操作会写入操作日志</div>
        </div>
        <SettingsTabs />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">筛选</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            placeholder="action（如 user.create）"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <input
            value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
            placeholder="操作人用户名"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
          >
            {loading ? "查询中…" : "查询"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">日志列表</div>
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
          <div className="grid grid-cols-5 bg-surface-2 px-3 py-2 text-xs text-muted">
            <div>ID</div>
            <div>时间</div>
            <div>操作人</div>
            <div>action</div>
            <div className="text-right">目标</div>
          </div>
          <div className="divide-y divide-border">
            {logs.map((l) => (
              <div key={l.id} className="grid grid-cols-5 items-center px-3 py-2 text-sm">
                <div className="text-muted">{l.id}</div>
                <div className="truncate text-muted">{l.created_at}</div>
                <div className="truncate text-muted">{l.actor_username ?? "—"}</div>
                <div className="truncate">{l.action}</div>
                <div className="truncate text-right text-muted">
                  {l.target_type ?? "—"}:{l.target_id ?? "—"}
                </div>
              </div>
            ))}
            {logs.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted">暂无数据</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
