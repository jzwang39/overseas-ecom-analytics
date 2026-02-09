"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RecordRow = { id: number; updated_at: string; data: unknown };

function toRecordStringUnknown(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function looksLikeUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function looksLikeImagePath(value: string) {
  const v = value.toLowerCase();
  return (
    v.startsWith("/uploads/") ||
    v.endsWith(".png") ||
    v.endsWith(".jpg") ||
    v.endsWith(".jpeg") ||
    v.endsWith(".webp") ||
    v.endsWith(".gif")
  );
}

export function ConfirmClient({
  groupLabel,
  title,
  schemaUrl = "/api/confirm/schema",
  recordsBaseUrl = "/api/confirm/records",
  createId,
}: {
  groupLabel: string;
  title: string;
  schemaUrl?: string;
  recordsBaseUrl?: string;
  createId?: { label: string; fieldName: string } | null;
}) {
  const BATCH_KEEP_FIELDS = useMemo(
    () => ["运营人员", "店铺名称", "产品名称", "SKC", "SKU", "产品规格", "链接标签"],
    [],
  );
  const [fields, setFields] = useState<string[] | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const todayKey = useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  const batchOnceStorageKey = useMemo(() => `batch_copy_yesterday:${recordsBaseUrl}`, [recordsBaseUrl]);
  const [batchUsedToday, setBatchUsedToday] = useState(false);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showAllFilters, setShowAllFilters] = useState(false);

  const createIdConfig = useMemo(() => {
    return createId === undefined ? { label: "选品ID（与选品表ID一致）", fieldName: "选品ID" } : createId;
  }, [createId]);

  const [editing, setEditing] = useState<{
    id: number | null;
    data: Record<string, string>;
  } | null>(null);

  const filterFields = useMemo(() => {
    if (!fields) return [];
    return showAllFilters ? fields : fields.slice(0, 12);
  }, [fields, showAllFilters]);

  const loadSchema = useCallback(async () => {
    try {
      setSchemaError(null);
      const res = await fetch(schemaUrl);
      const json = (await res.json().catch(() => null)) as { fields?: unknown; error?: unknown } | null;
      if (!res.ok) {
        const msg = typeof json?.error === "string" ? json.error : `HTTP ${res.status}`;
        setSchemaError(`读取字段失败：${msg}`);
        return;
      }
      const f = Array.isArray(json?.fields) ? json!.fields.filter((v) => typeof v === "string") : null;
      if (!f) {
        setSchemaError("读取字段失败：接口返回格式错误");
        return;
      }
      setFields(f);
    } catch (err) {
      setSchemaError(`读取字段失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  }, [schemaUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(recordsBaseUrl, window.location.origin);
      if (q.trim()) url.searchParams.set("q", q.trim());
      url.searchParams.set("filters", JSON.stringify(filters));
      url.searchParams.set("limit", "50");
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as { records?: unknown } | null;
      const rows = Array.isArray(json?.records) ? (json!.records as RecordRow[]) : [];
      setRecords(rows);
    } finally {
      setLoading(false);
    }
  }, [filters, q, recordsBaseUrl]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      setBatchUsedToday(localStorage.getItem(batchOnceStorageKey) === todayKey);
    } catch {
      setBatchUsedToday(false);
    }
  }, [batchOnceStorageKey, todayKey]);

  function openCreate() {
    if (!fields) return;
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = "";
    setEditing({ id: null, data });
  }

  function openEdit(row: RecordRow) {
    if (!fields) return;
    const obj = toRecordStringUnknown(row.data);
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = obj[f] == null ? "" : String(obj[f]);
    setEditing({ id: row.id, data });
  }

  const canBatchCreate = useMemo(() => {
    if (createIdConfig) return false;
    if (!fields) return false;
    for (const f of BATCH_KEEP_FIELDS) {
      if (!fields.includes(f)) return false;
    }
    return true;
  }, [BATCH_KEEP_FIELDS, createIdConfig, fields]);

  const markBatchUsed = useCallback(() => {
    try {
      localStorage.setItem(batchOnceStorageKey, todayKey);
    } catch {}
    setBatchUsedToday(true);
  }, [batchOnceStorageKey, todayKey]);

  const batchCreateFromYesterday = useCallback(async () => {
    if (!canBatchCreate) return;
    if (batchLoading) return;
    if (batchUsedToday) return;
    setBatchLoading(true);
    try {
      const res = await fetch(recordsBaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch_copy_yesterday", keepFields: BATCH_KEEP_FIELDS }),
      });
      const json = (await res.json().catch(() => null)) as { inserted?: unknown; error?: unknown } | null;
      if (!res.ok) {
        if (res.status === 409) markBatchUsed();
        alert(typeof json?.error === "string" ? json.error : "批量新增失败");
        return;
      }
      const inserted = typeof json?.inserted === "number" ? json.inserted : 0;
      markBatchUsed();
      alert(`批量新增完成：新增 ${inserted} 条`);
      await load();
    } finally {
      setBatchLoading(false);
    }
  }, [BATCH_KEEP_FIELDS, batchLoading, batchUsedToday, canBatchCreate, load, markBatchUsed, recordsBaseUrl]);

  async function save() {
    if (!fields || !editing) return;
    const payload: Record<string, unknown> = {};
    for (const f of fields) payload[f] = editing.data[f] ?? "";

    if (editing.id == null) {
      if (createIdConfig) {
        const raw = (editing.data[createIdConfig.fieldName] ?? "").trim();
        const id = Number(raw);
        if (!Number.isFinite(id) || id <= 0) {
          alert("请填写有效的ID");
          return;
        }
        const res = await fetch(recordsBaseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, data: payload }),
        });
        if (!res.ok) {
          alert("创建失败");
          return;
        }
      } else {
        const res = await fetch(recordsBaseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: payload }),
        });
        if (!res.ok) {
          alert("创建失败");
          return;
        }
      }
    } else {
      const res = await fetch(`${recordsBaseUrl}/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      });
      if (!res.ok) {
        alert("保存失败");
        return;
      }
    }

    setEditing(null);
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">{groupLabel}</div>
          <div className="mt-1 truncate text-lg font-semibold">{title}</div>
        </div>
        {fields ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={openCreate}
            >
              新增数据
            </button>
            {canBatchCreate ? (
              <button
                type="button"
                disabled={batchLoading || batchUsedToday}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2 disabled:opacity-50"
                onClick={batchCreateFromYesterday}
              >
                批量新增数据
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3">
          {fields ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {filterFields.map((f) => (
                  <input
                    key={f}
                    value={filters[f] ?? ""}
                    onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}
                    placeholder={f}
                    className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  onClick={() => setShowAllFilters((v) => !v)}
                >
                  {showAllFilters ? "收起筛选" : "更多筛选"}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
                  onClick={load}
                >
                  {loading ? "查询中…" : "查询"}
                </button>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="按字段搜索（在 JSON 内容里模糊匹配）"
                className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none sm:col-span-2"
              />
              <button
                type="button"
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
                onClick={load}
              >
                {loading ? "查询中…" : "查询"}
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            {fields ? (
              <div className="overflow-auto">
                <table className="min-w-max border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-surface-2 text-xs text-muted">
                      <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">ID</th>
                      {fields.map((f) => (
                        <th key={f} className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          {f}
                        </th>
                      ))}
                      <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {records.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-sm text-muted" colSpan={fields.length + 2}>
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => {
                        const obj = toRecordStringUnknown(row.data);
                        return (
                          <tr key={row.id} className="border-b border-border">
                            <td className="border-b border-border px-3 py-2 text-muted">{row.id}</td>
                            {fields.map((f) => {
                              const v = obj[f] == null ? "" : String(obj[f]);
                              const isImageField = f.includes("图片");
                              const isLinkField = f.includes("链接") || f.includes("链接/") || f.includes("供应商");
                              return (
                                <td
                                  key={f}
                                  className={
                                    isImageField
                                      ? "border-b border-border px-3 py-2"
                                      : "max-w-[220px] truncate border-b border-border px-3 py-2 text-muted"
                                  }
                                >
                                  {isImageField && v && looksLikeImagePath(v) ? (
                                    <a
                                      href={v}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 text-foreground"
                                      title={v}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      已上传
                                    </a>
                                  ) : isLinkField && v && looksLikeUrl(v) ? (
                                    <a
                                      href={v}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-foreground underline"
                                      title={v}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      打开
                                    </a>
                                  ) : (
                                    <span title={v} className="block truncate">
                                      {v}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="border-b border-border px-3 py-2 text-right">
                              <button
                                type="button"
                                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                                onClick={() => openEdit(row)}
                              >
                                修改
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-3 py-6 text-sm text-muted">
                {schemaError ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">{schemaError}</div>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                      onClick={loadSchema}
                    >
                      重试
                    </button>
                  </div>
                ) : (
                  "读取字段中…"
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{editing.id ? `修改（ID: ${editing.id}）` : "新增"}</div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                title="关闭"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {!editing.id && createIdConfig ? (
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <div className="text-xs text-muted">{createIdConfig.label}</div>
                    <input
                      inputMode="numeric"
                      value={editing.data[createIdConfig.fieldName] ?? ""}
                      onChange={(e) =>
                        setEditing((prev) =>
                          prev
                            ? {
                                ...prev,
                                data: { ...prev.data, [createIdConfig.fieldName]: e.target.value },
                              }
                            : prev,
                        )
                      }
                      className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                ) : null}

                {fields?.map((f) => (
                  <div key={f} className="flex flex-col gap-1">
                    <div className="min-w-0 flex-1 truncate text-xs text-muted">{f}</div>
                    <input
                      value={editing.data[f] ?? ""}
                      onChange={(e) =>
                        setEditing((prev) => (prev ? { ...prev, data: { ...prev.data, [f]: e.target.value } } : prev))
                      }
                      className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2"
                onClick={save}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
