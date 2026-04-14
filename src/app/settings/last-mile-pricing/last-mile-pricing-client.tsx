"use client";

import { useEffect, useRef, useState } from "react";
import { SettingsTabs } from "../settings-tabs";

type PricingRow = {
  id: number;
  weight_lbs: string | null;
  price: string;
  original_price: string | null;
  sort_order: number;
  note: string | null;
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

function formatNum(val: string | null) {
  if (val == null) return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return val;
  return n.toString();
}

export function LastMilePricingClient() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);

  // inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editWeightLbs, setEditWeightLbs] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editOriginalPrice, setEditOriginalPrice] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // new row form
  const [newWeightLbs, setNewWeightLbs] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newOriginalPrice, setNewOriginalPrice] = useState("");
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);

  // delete confirm
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const pendingDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // search
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/last-mile-pricing", { cache: "no-store" });
      if (!res.ok) {
        alert(await readApiError(res));
        setRows([]);
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      const list =
        json && typeof json === "object" && "rows" in json
          ? (json as { rows?: unknown }).rows
          : null;
      setRows(Array.isArray(list) ? (list as PricingRow[]) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (pendingDeleteId == null) return;
    pendingDeleteTimer.current = setTimeout(() => setPendingDeleteId(null), 3000);
    return () => {
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
    };
  }, [pendingDeleteId]);

  function startEdit(row: PricingRow) {
    setPendingDeleteId(null);
    setEditingId(row.id);
    setEditWeightLbs(row.weight_lbs != null ? String(Number(row.weight_lbs)) : "");
    setEditPrice(String(Number(row.price)));
    setEditOriginalPrice(row.original_price != null ? String(Number(row.original_price)) : "");
    setEditNote(row.note ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    if (editSaving) return;
    const priceVal = parseFloat(editPrice.trim());
    if (!editPrice.trim() || !Number.isFinite(priceVal) || priceVal < 0) {
      alert("请输入有效的价格");
      return;
    }
    const weightTrimmed = editWeightLbs.trim();
    const weightVal = weightTrimmed ? parseFloat(weightTrimmed) : null;
    if (weightTrimmed && (!Number.isFinite(weightVal) || (weightVal ?? 0) <= 0)) {
      alert("请输入有效的磅数");
      return;
    }
    const origTrimmed = editOriginalPrice.trim();
    const origVal = origTrimmed ? parseFloat(origTrimmed) : null;
    if (origTrimmed && (!Number.isFinite(origVal) || (origVal ?? 0) < 0)) {
      alert("请输入有效的原价格");
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/last-mile-pricing/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight_lbs: weightVal,
          price: priceVal,
          original_price: origVal,
          note: editNote.trim() || null,
        }),
      });
      if (!res.ok) {
        alert(await readApiError(res));
        return;
      }
      setEditingId(null);
      await load();
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteRow(id: number) {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
    setPendingDeleteId(null);
    const res = await fetch(`/api/admin/last-mile-pricing/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ softDelete: true }),
    });
    if (!res.ok) {
      alert(await readApiError(res));
      return;
    }
    await load();
  }

  async function createRow() {
    if (creating) return;
    const priceVal = parseFloat(newPrice.trim());
    if (!newPrice.trim() || !Number.isFinite(priceVal) || priceVal < 0) {
      alert("请输入有效的价格");
      return;
    }
    const weightTrimmed = newWeightLbs.trim();
    const weightVal = weightTrimmed ? parseFloat(weightTrimmed) : null;
    if (weightTrimmed && (!Number.isFinite(weightVal) || (weightVal ?? 0) <= 0)) {
      alert("请输入有效的磅数");
      return;
    }
    const origTrimmed = newOriginalPrice.trim();
    const origVal = origTrimmed ? parseFloat(origTrimmed) : null;
    if (origTrimmed && (!Number.isFinite(origVal) || (origVal ?? 0) < 0)) {
      alert("请输入有效的原价格");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/last-mile-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight_lbs: weightVal,
          price: priceVal,
          original_price: origVal,
          note: newNote.trim() || null,
        }),
      });
      if (!res.ok) {
        alert(await readApiError(res));
        return;
      }
      setNewWeightLbs("");
      setNewPrice("");
      setNewOriginalPrice("");
      setNewNote("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  const filteredRows = search.trim()
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        if (r.weight_lbs && r.weight_lbs.includes(q)) return true;
        if (r.price.includes(q)) return true;
        if (r.original_price && r.original_price.includes(q)) return true;
        if (r.note && r.note.toLowerCase().includes(q)) return true;
        return false;
      })
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">配置管理</div>
          <div className="mt-1 text-sm text-muted">
            尾程价目表（磅→美元，1磅≈0.4536kg）
          </div>
        </div>
        <SettingsTabs />
      </div>

      {/* 新增表单 */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-medium">新增价格档位</div>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">磅数（可选）</label>
            <input
              value={newWeightLbs}
              onChange={(e) => setNewWeightLbs(e.target.value)}
              placeholder="如 0.5 / 10"
              className="h-9 w-32 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">价格（美元）*</label>
            <input
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="如 3.10"
              className="h-9 w-32 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">原价格（可选）</label>
            <input
              value={newOriginalPrice}
              onChange={(e) => setNewOriginalPrice(e.target.value)}
              placeholder="如 3.10"
              className="h-9 w-32 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">备注（可选）</label>
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="备注"
              className="h-9 w-40 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={creating || loading}
              onClick={createRow}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
            >
              {creating ? "保存中…" : "新增"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={load}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">价目列表</div>
            <div className="text-xs text-muted">共 {rows.length} 条</div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索磅数/价格…"
            className="h-8 w-48 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {/* 表头 */}
          <div className="grid grid-cols-[3rem_7rem_8rem_8rem_1fr_7rem] bg-surface-2 px-3 py-2 text-xs text-muted">
            <div>#</div>
            <div>磅（lbs）</div>
            <div>价格（$）</div>
            <div>原价格（$）</div>
            <div>备注</div>
            <div className="text-right">操作</div>
          </div>

          <div className="max-h-[640px] divide-y divide-border overflow-y-auto">
            {filteredRows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[3rem_7rem_8rem_8rem_1fr_7rem] items-center px-3 py-1.5 text-sm"
              >
                <div className="text-xs text-muted">{r.sort_order}</div>

                {editingId === r.id ? (
                  <>
                    <div>
                      <input
                        value={editWeightLbs}
                        onChange={(e) => setEditWeightLbs(e.target.value)}
                        className="h-8 w-full rounded border border-border bg-surface px-2 text-sm outline-none"
                        placeholder="磅数"
                      />
                    </div>
                    <div>
                      <input
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="h-8 w-full rounded border border-primary bg-surface px-2 text-sm outline-none"
                        placeholder="价格"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(r.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                    </div>
                    <div>
                      <input
                        value={editOriginalPrice}
                        onChange={(e) => setEditOriginalPrice(e.target.value)}
                        className="h-8 w-full rounded border border-border bg-surface px-2 text-sm outline-none"
                        placeholder="原价格"
                      />
                    </div>
                    <div>
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        className="h-8 w-full rounded border border-border bg-surface px-2 text-sm outline-none"
                        placeholder="备注"
                      />
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        disabled={editSaving}
                        onClick={() => void saveEdit(r.id)}
                        className="inline-flex h-7 items-center justify-center rounded border border-primary bg-surface px-2 text-xs font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                      >
                        {editSaving ? "…" : "保存"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="inline-flex h-7 items-center justify-center rounded border border-border bg-surface px-2 text-xs hover:bg-surface-2"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tabular-nums">
                      {r.weight_lbs != null ? formatNum(r.weight_lbs) : <span className="text-muted">—</span>}
                    </div>
                    <div className="tabular-nums font-medium">{formatNum(r.price)}</div>
                    <div className="tabular-nums text-muted">{formatNum(r.original_price)}</div>
                    <div className="truncate text-muted">{r.note || ""}</div>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-xs hover:bg-surface-2"
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteRow(r.id)}
                        className={[
                          "inline-flex h-7 items-center justify-center rounded border px-2 text-xs",
                          pendingDeleteId === r.id
                            ? "border-red-400 bg-red-50 text-red-600 hover:bg-red-100"
                            : "border-border bg-surface hover:bg-surface-2",
                        ].join(" ")}
                        title="删除"
                      >
                        {pendingDeleteId === r.id ? "确认删除" : "删除"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {filteredRows.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted">
                {loading ? "加载中…" : search.trim() ? "无匹配结果" : "暂无数据"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
