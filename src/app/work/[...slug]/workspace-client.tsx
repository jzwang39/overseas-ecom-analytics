"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getWorkspaceSchema } from "@/lib/workspace/schemas";

type RecordRow = { id: number; updated_at: string; data: unknown };

function toRecordStringUnknown(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function looksLikeUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function toCategoryName(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const v = value as { name?: unknown };
  return typeof v.name === "string" ? v.name : null;
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

type FieldKind = "text" | "url" | "number" | "image" | "category" | "yesno";

const IMAGE_FIELDS = new Set(["产品图片", "产品实物图", "包裹实物包装图"]);
const URL_FIELDS = new Set(["参考链接", "产品链接×"]);

const PURCHASE_UI_HIDDEN_FIELDS = new Set([
  "询价人",
  "产品尺寸-长（厘米）",
  "产品尺寸-宽（厘米）",
  "产品尺寸-高（厘米）",
  "包装尺寸-长（英寸）",
  "包装尺寸-宽（英寸）",
  "包装尺寸-高（英寸）",
  "产品体积",
  "产品重量",
  "产品实物图",
  "包裹尺寸-长（厘米）",
  "包裹尺寸-宽（厘米）",
  "包裹尺寸-高（厘米）",
  "包裹体积（立方厘米）",
  "体积重系数",
  "体积重",
  "包裹实重（公斤）",
  "包裹计费重",
  "包裹计费重（磅）",
  "包裹尺寸-长（英寸）",
  "包裹尺寸-宽（英寸）",
  "包裹尺寸-高（英寸）",
  "包裹实物包装图",
  "箱规",
  "运输包装尺寸-长（厘米）",
  "运输包装尺寸-宽（厘米）",
  "运输包装尺寸-高（厘米）",
  "运输包装体积",
  "运输包装体积系数",
  "运输包装体积重",
  "运输包装实重",
  "运输包装计费重",
  "产品单价",
  "起订量",
  "优惠政策",
  "交货周期",
  "资质情况",
  "专利情况",
  "工厂所在地",
  "工厂联系人",
  "联系人电话",
  "海外仓（卸货费）",
  "海外仓（操作费）",
  "派送费（需要测试？）",
  "美元汇率",
  "尾程成本（人民币）",
  "头程单价（人民币）？",
  "头程成本",
  "采购成本",
  "负向成本",
  "成本总计",
  "人民币报价",
  "temu核价最低标准（未加2.99）",
  "temu报价",
  "temu售价",
  "卖价",
]);

const INQUIRY_UI_HIDDEN_FIELDS = new Set([
  "海外仓（卸货费）",
  "海外仓（操作费）",
  "派送费（需要测试？）",
  "美元汇率",
  "尾程成本（人民币）",
  "头程单价（人民币）？",
  "头程成本",
  "采购成本",
  "负向成本",
  "成本总计",
  "人民币报价",
  "temu核价最低标准（未加2.99）",
  "temu报价",
  "temu售价",
  "卖价",
]);

const CM_TO_IN = 0.3937;
const KG_TO_LB = 2.2;

function isNumericField(field: string) {
  return (
    field.includes("价格") ||
    field.includes("尺寸") ||
    field.includes("体积") ||
    field.includes("重量") ||
    field.includes("系数") ||
    field.includes("单价") ||
    field.includes("起订量") ||
    field.includes("汇率") ||
    field.includes("成本") ||
    field.includes("报价") ||
    field.includes("售价") ||
    field.includes("卖价") ||
    field.includes("销量") ||
    field.includes("实重") ||
    field.includes("计费重") ||
    field.includes("费用")
  );
}

function getFieldKind(field: string): FieldKind {
  if (IMAGE_FIELDS.has(field)) return "image";
  if (URL_FIELDS.has(field)) return "url";
  if (field === "所属类目") return "category";
  if (field === "是否有专利风险") return "yesno";
  if (isNumericField(field)) return "number";
  return "text";
}

function getDefaultFieldValue(field: string) {
  const kind = getFieldKind(field);
  if (kind === "yesno") return "否";
  if (field === "体积重系数" || field === "运输包装体积系数") return "6000";
  return "";
}

function toFiniteNumber(raw: string) {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatDecimal(n: number, digits = 4) {
  const s = n.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function getCmSourceForInchField(schema: { fields: string[] } | null, field: string) {
  if (!schema) return null;
  if (!field.endsWith("（英寸）")) return null;

  const sameName = field.replace(/（英寸）$/, "（厘米）");
  if (sameName !== field && schema.fields.includes(sameName)) return sameName;

  if (field.startsWith("包装尺寸-")) {
    const source = field.replace(/^包装尺寸-/, "产品尺寸-").replace(/（英寸）$/, "（厘米）");
    if (source !== field && schema.fields.includes(source)) return source;
  }

  return null;
}

function cmToInchesValue(cmRaw: string) {
  const cm = toFiniteNumber(cmRaw);
  if (cm == null) return null;
  return formatDecimal(cm * CM_TO_IN, 4);
}

const MAX_COMPUTED_RULES = [
  { target: "包裹计费重", a: "体积重", b: "包裹实重（公斤）" },
  { target: "运输包装计费重", a: "运输包装体积重", b: "运输包装实重" },
] as const;

type MaxComputedRule = (typeof MAX_COMPUTED_RULES)[number];

function getMaxComputedRule(schema: { fields: string[] } | null, target: string): MaxComputedRule | null {
  if (!schema) return null;
  for (const r of MAX_COMPUTED_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.a)) return null;
    if (!schema.fields.includes(r.b)) return null;
    return r;
  }
  return null;
}

function maxOfTwo(rawA: string, rawB: string) {
  const a = toFiniteNumber(rawA);
  const b = toFiniteNumber(rawB);
  if (a == null && b == null) return null;
  if (a == null) return formatDecimal(b!, 4);
  if (b == null) return formatDecimal(a, 4);
  return formatDecimal(Math.max(a, b), 4);
}

const MULTIPLIER_CEIL_RULES = [{ target: "包裹计费重（磅）", source: "包裹计费重", factor: KG_TO_LB, step: 1 }] as const;

type MultiplierCeilRule = (typeof MULTIPLIER_CEIL_RULES)[number];

function getMultiplierCeilRule(schema: { fields: string[] } | null, target: string): MultiplierCeilRule | null {
  if (!schema) return null;
  for (const r of MULTIPLIER_CEIL_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.source)) return null;
    return r;
  }
  return null;
}

function ceilToMultiple(n: number, step: number) {
  if (!Number.isFinite(n)) return null;
  if (!Number.isFinite(step) || step <= 0) return null;
  return Math.ceil(n / step) * step;
}

function multiplyAndCeil(raw: string, factor: number, step: number) {
  const v = toFiniteNumber(raw);
  if (v == null) return null;
  const out = ceilToMultiple(v * factor, step);
  if (out == null) return null;
  if (step === 1) return String(out);
  return formatDecimal(out, 4);
}

const DIVIDE_RULES = [{ target: "体积重", numerator: "包裹体积（立方厘米）", denominator: "体积重系数", digits: 4 }] as const;

type DivideRule = (typeof DIVIDE_RULES)[number];

function getDivideRule(schema: { fields: string[] } | null, target: string): DivideRule | null {
  if (!schema) return null;
  for (const r of DIVIDE_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.numerator)) return null;
    if (!schema.fields.includes(r.denominator)) return null;
    return r;
  }
  return null;
}

function divideValue(data: Record<string, string>, rule: DivideRule) {
  const a = toFiniteNumber(data[rule.numerator] ?? "");
  const b = toFiniteNumber(data[rule.denominator] ?? "");
  if (a == null || b == null) return null;
  if (b === 0) return null;
  return formatDecimal(a / b, rule.digits);
}

const RANGE_VALUE_RULES = [
  {
    target: "运输包装体积系数",
    source: "运输包装体积",
    ranges: [
      { gt: 0, lte: 5, value: "0.6" },
      { gt: 5, lte: 10, value: "0.7" },
      { gt: 10, lte: 20, value: "0.8" },
    ],
  },
] as const;

type RangeValueRule = (typeof RANGE_VALUE_RULES)[number];

function getRangeValueRule(schema: { fields: string[] } | null, target: string): RangeValueRule | null {
  if (!schema) return null;
  for (const r of RANGE_VALUE_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.source)) return null;
    return r;
  }
  return null;
}

function mapRangeValue(raw: string, rule: RangeValueRule) {
  const v = toFiniteNumber(raw);
  if (v == null) return null;
  for (const r of rule.ranges) {
    if (v > r.gt && v <= r.lte) return r.value;
  }
  return null;
}

const COPY_VALUE_RULES: ReadonlyArray<{ target: string; source: string }> = [];

type CopyValueRule = (typeof COPY_VALUE_RULES)[number];

function getCopyValueRule(schema: { fields: string[] } | null, target: string): CopyValueRule | null {
  if (!schema) return null;
  for (const r of COPY_VALUE_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.source)) return null;
    return r;
  }
  return null;
}

function copyValue(data: Record<string, string>, rule: CopyValueRule) {
  const v = (data[rule.source] ?? "").trim();
  return v ? v : null;
}

const MULTIPLY_CONST_RULES = [{ target: "人民币报价", source: "成本总计", factor: 1.2, digits: 4 }] as const;

type MultiplyConstRule = (typeof MULTIPLY_CONST_RULES)[number];

function getMultiplyConstRule(schema: { fields: string[] } | null, target: string): MultiplyConstRule | null {
  if (!schema) return null;
  for (const r of MULTIPLY_CONST_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.source)) return null;
    return r;
  }
  return null;
}

function multiplyConstValue(data: Record<string, string>, rule: MultiplyConstRule) {
  const v = toFiniteNumber(data[rule.source] ?? "");
  if (v == null) return null;
  return formatDecimal(v * rule.factor, rule.digits);
}

const DIVIDE_CONST_RULES = [
  { target: "temu核价最低标准（未加2.99）", source: "成本总计", divisor: 0.6, digits: 4 },
  { target: "temu报价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 4 },
  { target: "temu售价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 4 },
] as const;

type DivideConstRule = (typeof DIVIDE_CONST_RULES)[number];

function getDivideConstRule(schema: { fields: string[] } | null, target: string): DivideConstRule | null {
  if (!schema) return null;
  for (const r of DIVIDE_CONST_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.source)) return null;
    return r;
  }
  return null;
}

function divideConstValue(data: Record<string, string>, rule: DivideConstRule) {
  const v = toFiniteNumber(data[rule.source] ?? "");
  if (v == null) return null;
  return formatDecimal(v / rule.divisor, rule.digits);
}

const SUM_MULTIPLY_CONST_RULES = [
  { target: "负向成本", addends: ["头程成本", "采购成本", "尾程成本（人民币）"], factor: 0.1, digits: 4 },
] as const;

type SumMultiplyConstRule = (typeof SUM_MULTIPLY_CONST_RULES)[number];

function getSumMultiplyConstRule(
  schema: { fields: string[] } | null,
  target: string,
): SumMultiplyConstRule | null {
  if (!schema) return null;
  for (const r of SUM_MULTIPLY_CONST_RULES) {
    if (r.target !== target) continue;
    for (const f of r.addends) if (!schema.fields.includes(f)) return null;
    return r;
  }
  return null;
}

function sumMultiplyConstValue(data: Record<string, string>, rule: SumMultiplyConstRule) {
  let any = false;
  let sum = 0;
  for (const f of rule.addends) {
    const v = toFiniteNumber(data[f] ?? "");
    if (v == null) continue;
    any = true;
    sum += v;
  }
  if (!any) return null;
  return formatDecimal(sum * rule.factor, rule.digits);
}

const SUM_MULTIPLY_RULES = [
  {
    target: "尾程成本（人民币）",
    addends: ["海外仓（卸货费）", "海外仓（操作费）", "派送费（需要测试？）"],
    factor: "美元汇率",
    digits: 4,
  },
] as const;

type SumMultiplyRule = (typeof SUM_MULTIPLY_RULES)[number];

function getSumMultiplyRule(schema: { fields: string[] } | null, target: string): SumMultiplyRule | null {
  if (!schema) return null;
  for (const r of SUM_MULTIPLY_RULES) {
    if (r.target !== target) continue;
    if (!schema.fields.includes(r.factor)) return null;
    for (const f of r.addends) if (!schema.fields.includes(f)) return null;
    return r;
  }
  return null;
}

function sumMultiplyValue(data: Record<string, string>, rule: SumMultiplyRule) {
  const factor = toFiniteNumber(data[rule.factor] ?? "");
  if (factor == null) return null;
  let any = false;
  let sum = 0;
  for (const f of rule.addends) {
    const v = toFiniteNumber(data[f] ?? "");
    if (v == null) continue;
    any = true;
    sum += v;
  }
  if (!any) return null;
  return formatDecimal(sum * factor, rule.digits);
}

function formatComputedHelp(schema: { fields: string[] }, field: string) {
  const inchSource = getCmSourceForInchField(schema, field);
  if (inchSource) return `= ${inchSource} × ${CM_TO_IN}`;

  const maxRule = getMaxComputedRule(schema, field);
  if (maxRule) return `= max(${maxRule.a}, ${maxRule.b})`;

  const multRule = getMultiplierCeilRule(schema, field);
  if (multRule) {
    if (multRule.step === 1) return `= 向上取整(${multRule.source} × ${multRule.factor})`;
    return `= 向上取整(${multRule.source} × ${multRule.factor}, 步长 ${multRule.step})`;
  }

  const divideRule = getDivideRule(schema, field);
  if (divideRule) return `= ${divideRule.numerator} / ${divideRule.denominator}`;

  const rangeRule = getRangeValueRule(schema, field);
  if (rangeRule) {
    const parts = rangeRule.ranges.map((r) => `(${rangeRule.source} > ${r.gt} 且 ≤ ${r.lte}) ⇒ ${r.value}`);
    return parts.join("；");
  }

  const sumRule = getSumMultiplyRule(schema, field);
  if (sumRule) return `= (${sumRule.addends.join(" + ")}) × ${sumRule.factor}`;

  const sumConstRule = getSumMultiplyConstRule(schema, field);
  if (sumConstRule) return `= (${sumConstRule.addends.join(" + ")}) × ${sumConstRule.factor}`;

  const multConstRule = getMultiplyConstRule(schema, field);
  if (multConstRule) return `= ${multConstRule.source} × ${multConstRule.factor}`;

  const divideConstRule = getDivideConstRule(schema, field);
  if (divideConstRule) return `= ${divideConstRule.source} / ${divideConstRule.divisor}`;

  const copyRule = getCopyValueRule(schema, field);
  if (copyRule) return `= ${copyRule.source}`;

  return null;
}

function applyComputedFields(schema: { fields: string[] }, data: Record<string, string>) {
  const out: Record<string, string> = { ...data };

  for (const f of schema.fields) {
    const source = getCmSourceForInchField(schema, f);
    if (!source) continue;
    const computed = cmToInchesValue(out[source] ?? "");
    if (computed != null) out[f] = computed;
  }

  for (const r of MAX_COMPUTED_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.a)) continue;
    if (!schema.fields.includes(r.b)) continue;
    const computed = maxOfTwo(out[r.a] ?? "", out[r.b] ?? "");
    out[r.target] = computed ?? "";
  }

  for (const r of MULTIPLIER_CEIL_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = multiplyAndCeil(out[r.source] ?? "", r.factor, r.step) ?? "";
  }

  for (const r of DIVIDE_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.numerator)) continue;
    if (!schema.fields.includes(r.denominator)) continue;
    out[r.target] = divideValue(out, r) ?? "";
  }

  for (const r of RANGE_VALUE_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = mapRangeValue(out[r.source] ?? "", r) ?? "";
  }

  for (const r of COPY_VALUE_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = copyValue(out, r) ?? "";
  }

  for (const r of MULTIPLY_CONST_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = multiplyConstValue(out, r) ?? "";
  }

  for (const r of DIVIDE_CONST_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = divideConstValue(out, r) ?? "";
  }

  for (const r of SUM_MULTIPLY_CONST_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) ok = false;
    if (!ok) continue;
    out[r.target] = sumMultiplyConstValue(out, r) ?? "";
  }

  for (const r of SUM_MULTIPLY_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.factor)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) ok = false;
    if (!ok) continue;
    out[r.target] = sumMultiplyValue(out, r) ?? "";
  }

  return out;
}

function formatNow() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function WorkspaceClient({
  workspaceKey,
  title,
  groupLabel,
}: {
  workspaceKey: string;
  title: string;
  groupLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [q, setQ] = useState("");

  const schema = useMemo(() => getWorkspaceSchema(workspaceKey), [workspaceKey]);
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ id: number | null; data: Record<string, string> } | null>(
    null,
  );

  useEffect(() => {
    setFilters({});
    setShowAllFilters(false);
    setEditing(null);
    setUploadingField(null);
  }, [workspaceKey]);

  useEffect(() => {
    if (!schema) return;
    if (!schema.fields.includes("所属类目")) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/config/categories", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json: unknown = await res.json().catch(() => ({}));
        const raw =
          json && typeof json === "object" && "categories" in json
            ? (json as { categories?: unknown }).categories
            : null;
        if (!Array.isArray(raw)) return;
        const names: string[] = [];
        for (const item of raw) {
          const name = toCategoryName(item);
          if (name) names.push(name);
        }
        setCategories(names);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  }, [schema]);

  const visibleFields = useMemo(() => {
    if (!schema) return [];
    if (workspaceKey === "ops.purchase") {
      return schema.fields.filter((f) => !PURCHASE_UI_HIDDEN_FIELDS.has(f));
    }
    if (workspaceKey === "ops.inquiry") {
      return schema.fields.filter((f) => !INQUIRY_UI_HIDDEN_FIELDS.has(f));
    }
    return schema.fields;
  }, [schema, workspaceKey]);

  const exportUrl = useMemo(() => {
    const base = `/api/workspace/${encodeURIComponent(workspaceKey)}/export`;
    if (!schema) {
      if (!q) return base;
      return `${base}?q=${encodeURIComponent(q)}`;
    }
    const active: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = (filters[f] ?? "").trim();
      if (v) active[f] = v;
    }
    const qs = new URLSearchParams();
    if (Object.keys(active).length) qs.set("filters", JSON.stringify(active));
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  }, [filters, q, schema, visibleFields, workspaceKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = `/api/workspace/${encodeURIComponent(workspaceKey)}/records`;
      let url = base;
      if (!schema) {
        url = q ? `${base}?q=${encodeURIComponent(q)}` : base;
      } else {
        const active: Record<string, string> = {};
        for (const f of visibleFields) {
          const v = (filters[f] ?? "").trim();
          if (v) active[f] = v;
        }
        const qs = new URLSearchParams();
        if (Object.keys(active).length) qs.set("filters", JSON.stringify(active));
        const s = qs.toString();
        url = s ? `${base}?${s}` : base;
      }
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setRecords(json.records ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters, q, schema, visibleFields, workspaceKey]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    if (!schema) return;
    const data: Record<string, string> = {};
    for (const f of schema.fields) data[f] = getDefaultFieldValue(f);
    setEditing({ id: null, data: applyComputedFields(schema, data) });
  }

  function openEdit(row: RecordRow) {
    if (!schema) {
      setEditing({
        id: row.id,
        data: { __raw__: typeof row.data === "string" ? row.data : JSON.stringify(row.data, null, 2) },
      });
      return;
    }
    const obj = toRecordStringUnknown(row.data);
    const data: Record<string, string> = {};
    for (const f of schema.fields) {
      const v = obj[f] == null ? "" : String(obj[f]);
      data[f] = v || getDefaultFieldValue(f);
    }
    setEditing({ id: row.id, data: applyComputedFields(schema, data) });
  }

  async function uploadImage(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("仅支持图片文件");
      return null;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不能超过10M");
      return null;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload/image", { method: "POST", body: form });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "上传失败");
      return null;
    }
    const json = await res.json().catch(() => ({}));
    return typeof json.url === "string" ? json.url : null;
  }

  async function saveEdit() {
    if (!editing) return;
    if (!schema) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(editing.data.__raw__ ?? "{}");
      } catch {
        alert("JSON 格式错误");
        return;
      }
      const res = await fetch(
        `/api/workspace/${encodeURIComponent(workspaceKey)}/records/${editing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        },
      );
      if (!res.ok) {
        alert("保存失败");
        return;
      }
      setEditing(null);
      await load();
      return;
    }

    for (const f of visibleFields) {
      if (f === "创建时间" || f === "最后更新时间") continue;
      const v = (editing.data[f] ?? "").trim();
      const kind = getFieldKind(f);
      if (kind === "url" && v && !looksLikeUrl(v)) {
        alert(`${f} 需要以 http:// 或 https:// 开头`);
        return;
      }
      if (kind === "number" && v && !Number.isFinite(Number(v))) {
        alert(`${f} 需要是数字`);
        return;
      }
      if (kind === "category" && v && categories.length > 0 && !categories.includes(v)) {
        alert(`${f} 请选择已配置的类目`);
        return;
      }
      if (kind === "yesno" && v && v !== "是" && v !== "否") {
        alert(`${f} 只能选择“是”或“否”`);
        return;
      }
    }

    const payload: Record<string, unknown> = {};
    for (const f of schema.fields) payload[f] = editing.data[f] ?? "";
    if (!editing.id && schema.fields.includes("创建时间")) payload["创建时间"] = formatNow();
    if (schema.fields.includes("最后更新时间")) payload["最后更新时间"] = editing.id ? formatNow() : null;

    const url = editing.id
      ? `/api/workspace/${encodeURIComponent(workspaceKey)}/records/${editing.id}`
      : `/api/workspace/${encodeURIComponent(workspaceKey)}/records`;

    const res = await fetch(url, {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
    });
    if (!res.ok) {
      alert(editing.id ? "保存失败" : "创建失败");
      return;
    }
    setEditing(null);
    await load();
  }

  const filterFields = useMemo(() => {
    if (!schema) return [];
    return showAllFilters ? visibleFields : visibleFields.slice(0, 12);
  }, [schema, showAllFilters, visibleFields]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">{groupLabel}</div>
          <div className="mt-1 truncate text-lg font-semibold">{schema?.title ?? title}</div>
        </div>
        <div className="flex items-center gap-2">
          {schema ? (
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={openCreate}
            >
              {workspaceKey === "ops.selection_candidates" ? "增加选品备选数据" : "新增数据"}
            </button>
          ) : null}
          <a
            href={exportUrl}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
          >
            导出Excel
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3">
          {schema ? (
            <div className="flex flex-col gap-3">
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
            </div>
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
            {schema ? (
              <div className="overflow-auto">
                <table className="min-w-max border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-surface-2 text-xs text-muted">
                      {visibleFields.map((f) => (
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
                        <td className="px-3 py-6 text-sm text-muted" colSpan={visibleFields.length + 1}>
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => {
                        const obj = toRecordStringUnknown(row.data);
                        return (
                          <tr key={row.id} className="border-b border-border">
                            {visibleFields.map((f) => {
                              const v = obj[f] == null ? "" : String(obj[f]);
                              const kind = getFieldKind(f);
                              return (
                                <td
                                  key={f}
                                  className={
                                    kind === "image"
                                      ? "border-b border-border px-3 py-2"
                                      : "max-w-[220px] truncate border-b border-border px-3 py-2 text-muted"
                                  }
                                >
                                  {kind === "image" && v && looksLikeImagePath(v) ? (
                                    <a
                                      href={v}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 text-foreground"
                                      title={v}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.open(v, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <Image
                                        src={v}
                                        alt={f}
                                        width={40}
                                        height={40}
                                        className="h-10 w-10 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                      <span className="text-xs underline">查看</span>
                                    </a>
                                  ) : looksLikeUrl(v) ? (
                                    <a className="text-foreground underline" href={v} target="_blank" rel="noreferrer">
                                      链接
                                    </a>
                                  ) : (
                                    v || "—"
                                  )}
                                </td>
                              );
                            })}
                            <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right">
                              <button
                                type="button"
                                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
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
              <div>
                <div className="grid grid-cols-5 bg-surface-2 px-3 py-2 text-xs text-muted">
                  <div>ID</div>
                  <div className="col-span-3">数据</div>
                  <div className="text-right">操作</div>
                </div>
                <div className="divide-y divide-border">
                  {records.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-muted">暂无数据</div>
                  ) : (
                    records.map((row) => (
                      <div key={row.id} className="grid grid-cols-5 items-center px-3 py-2 text-sm">
                        <div className="text-muted">{row.id}</div>
                        <div className="col-span-3 truncate text-muted">
                          {typeof row.data === "string" ? row.data : JSON.stringify(row.data)}
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                            title="修改"
                            onClick={() => openEdit(row)}
                          >
                            ✎
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                {editing.id ? `修改（ID: ${editing.id}）` : "新增"}
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                title="关闭"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>
            {schema ? (
              <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {visibleFields.filter((f) => f !== "创建时间" && f !== "最后更新时间").map((f) => {
                    const kind = getFieldKind(f);
                    const sourceForInch = getCmSourceForInchField(schema, f);
                    const maxRule = getMaxComputedRule(schema, f);
                    const multRule = getMultiplierCeilRule(schema, f);
                    const divideRule = getDivideRule(schema, f);
                    const rangeRule = getRangeValueRule(schema, f);
                    const copyRule = getCopyValueRule(schema, f);
                    const multConstRule = getMultiplyConstRule(schema, f);
                    const divideConstRule = getDivideConstRule(schema, f);
                    const sumConstRule = getSumMultiplyConstRule(schema, f);
                    const sumRule = getSumMultiplyRule(schema, f);
                    const computedHelp = formatComputedHelp(schema, f);
                    const rawValue = editing.data[f] ?? "";
                    const computedInch = sourceForInch ? cmToInchesValue(editing.data[sourceForInch] ?? "") : null;
                    const computedMax = maxRule
                      ? maxOfTwo(editing.data[maxRule.a] ?? "", editing.data[maxRule.b] ?? "")
                      : null;
                    const computedMult = multRule
                      ? multiplyAndCeil(editing.data[multRule.source] ?? "", multRule.factor, multRule.step)
                      : null;
                    const computedDivide = divideRule ? divideValue(editing.data, divideRule) : null;
                    const computedRange = rangeRule ? mapRangeValue(editing.data[rangeRule.source] ?? "", rangeRule) : null;
                    const computedSum = sumRule ? sumMultiplyValue(editing.data, sumRule) : null;
                    const computedCopy = copyRule ? copyValue(editing.data, copyRule) : null;
                    const computedSumConst = sumConstRule ? sumMultiplyConstValue(editing.data, sumConstRule) : null;
                    const computedMultConst = multConstRule ? multiplyConstValue(editing.data, multConstRule) : null;
                    const computedDivideConst = divideConstRule ? divideConstValue(editing.data, divideConstRule) : null;
                    const value =
                      computedInch ??
                      computedMax ??
                      computedMult ??
                      computedDivide ??
                      computedRange ??
                      computedSum ??
                      computedSumConst ??
                      computedMultConst ??
                      computedDivideConst ??
                      computedCopy ??
                      rawValue;
                    const setValue = (next: string) =>
                      setEditing((prev) => {
                        if (!prev) return prev;
                        const nextData: Record<string, string> = { ...prev.data, [f]: next };
                        return { ...prev, data: applyComputedFields(schema, nextData) };
                      });

                    return (
                      <div key={f} className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 text-xs text-muted">
                          <div className="min-w-0 flex-1 truncate">{f}</div>
                          {computedHelp ? (
                            <button
                              type="button"
                              title={computedHelp}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-[10px] text-muted hover:bg-surface-2"
                            >
                              ?
                            </button>
                          ) : null}
                        </div>

                        {kind === "image" ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              accept="image/*"
                              disabled={uploadingField === f}
                              className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:opacity-60"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file) return;
                                setUploadingField(f);
                                try {
                                  const url = await uploadImage(file);
                                  if (url) setValue(url);
                                } finally {
                                  setUploadingField(null);
                                }
                              }}
                            />
                            {value ? (
                              <a
                                className="text-sm text-foreground underline"
                                href={value}
                                target="_blank"
                                rel="noreferrer"
                              >
                                已上传
                              </a>
                            ) : (
                              <div className="text-sm text-muted">{uploadingField === f ? "上传中…" : "未上传"}</div>
                            )}
                          </div>
                        ) : kind === "category" ? (
                          <select
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                          >
                            <option value="">请选择</option>
                            {value && !categories.includes(value) ? <option value={value}>{value}</option> : null}
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : kind === "yesno" ? (
                          <select
                            value={value || "否"}
                            onChange={(e) => setValue(e.target.value)}
                            className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                          >
                            <option value="否">否</option>
                            <option value="是">是</option>
                          </select>
                        ) : sourceForInch ||
                          maxRule ||
                          multRule ||
                          divideRule ||
                          rangeRule ||
                          sumRule ||
                          sumConstRule ||
                          multConstRule ||
                          divideConstRule ||
                          copyRule ? (
                          <input
                            type={kind === "url" ? "url" : kind === "number" ? "number" : "text"}
                            inputMode={kind === "number" ? "decimal" : undefined}
                            value={value}
                            disabled
                            placeholder="自动计算"
                            className="h-9 cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                          />
                        ) : (
                          <input
                            type={kind === "url" ? "url" : kind === "number" ? "number" : "text"}
                            inputMode={kind === "number" ? "decimal" : undefined}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <textarea
                value={editing.data.__raw__ ?? ""}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, data: { ...prev.data, __raw__: e.target.value } } : prev))
                }
                className="mt-3 h-80 w-full resize-none rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs outline-none"
              />
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2"
                onClick={saveEdit}
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
