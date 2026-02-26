"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getWorkspaceSchema } from "@/lib/workspace/schemas";
import { useSession } from "next-auth/react";

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
const INQUIRY_STATUS_VALUE = "待分配【询价】";
const MAIN_PROCESS_OPTIONS = ["注塑", "五金", "木制", "缝制", "印刷", "玻璃", "陶瓷", "电子组装", "其他"] as const;

function displayFieldLabel(field: string) {
  if (field === "名称") return "商品名称";
  if (field === "产品重量") return "产品重量（kg）";
  if (field === "产品尺寸-长（厘米）") return "产品尺寸（cm）-长";
  if (field === "产品尺寸-宽（厘米）") return "产品尺寸（cm）-宽";
  if (field === "产品尺寸-高（厘米）") return "产品尺寸（cm）-高";
  return field;
}

function parseImageUrls(raw: string) {
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const out: string[] = [];
        for (const v of parsed) if (typeof v === "string" && v.trim()) out.push(v.trim());
        if (out.length > 0) return out;
      }
    } catch {}
  }
  return s
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function joinImageUrls(urls: string[]) {
  return urls.map((v) => v.trim()).filter(Boolean).join("\n");
}

function parseDelimitedValues(raw: string) {
  const s = raw.trim();
  if (!s) return [];
  return s
    .split(/[,\uFF0C\r\n]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function joinDelimitedValues(values: string[]) {
  return values.map((v) => v.trim()).filter(Boolean).join("，");
}

const PURCHASE_UI_HIDDEN_FIELDS = new Set([
  "询价人",
  "产品规则",
  "产品规格输入方式",
  "包装尺寸-长（英寸）",
  "包装尺寸-宽（英寸）",
  "包装尺寸-高（英寸）",
  "产品体积",
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

const PURCHASE_PRODUCT_SIZE_FIELDS = ["产品尺寸-长（厘米）", "产品尺寸-宽（厘米）", "产品尺寸-高（厘米）"] as const;
const WORKSPACE_TABLE_HIDDEN_FIELDS = new Set(["产品链接×"]);
const PURCHASE_TABLE_HIDDEN_FIELDS = new Set([
  "选品人",
  "询价分配人｜选品",
  "询价负责人",
  "主要工艺",
]);
const INQUIRY_TABLE_HIDDEN_FIELDS = new Set([
  "平台在售价格（Min）",
  "平台在售价格（Max）",
  "资质要求",
  "是否有专利风险",
  "选品人",
  "询价分配人｜选品",
  "询价负责人",
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
]);

const INQUIRY_UI_HIDDEN_FIELDS = new Set([
  "产品规则",
  "产品规格输入方式",
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
  if (field === "产品规格输入方式") return "分开输入";
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

function inchesToCmValue(inRaw: string) {
  const inch = toFiniteNumber(inRaw);
  if (inch == null) return null;
  return formatDecimal(inch / CM_TO_IN, 4);
}

function kgToLbValue(kgRaw: string) {
  const kg = toFiniteNumber(kgRaw);
  if (kg == null) return null;
  return formatDecimal(kg * KG_TO_LB, 4);
}

function lbToKgValue(lbRaw: string) {
  const lb = toFiniteNumber(lbRaw);
  if (lb == null) return null;
  return formatDecimal(lb / KG_TO_LB, 4);
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
  hideCreateButton = false,
  hideInquiryCreateButton = false,
  createButtonLabel = "新增数据",
}: {
  workspaceKey: string;
  title: string;
  groupLabel: string;
  hideCreateButton?: boolean;
  hideInquiryCreateButton?: boolean;
  createButtonLabel?: string;
}) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [q, setQ] = useState("");

  const schema = useMemo(() => getWorkspaceSchema(workspaceKey), [workspaceKey]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [timeRange, setTimeRange] = useState<"" | "today" | "7d" | "30d">("");
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [imageIndexByField, setImageIndexByField] = useState<Record<string, number>>({});
  const [linkDraftByField, setLinkDraftByField] = useState<Record<string, string[]>>({});

  const [editing, setEditing] = useState<{ id: number | null; data: Record<string, string> } | null>(
    null,
  );

  const [inquiryCreateOpen, setInquiryCreateOpen] = useState(false);
  const [inquiryUnits, setInquiryUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [inquiryForm, setInquiryForm] = useState<{
    productName: string;
    category: string;
    productUnitPrice: string;
    moq: string;
    discountPolicy: "" | "有" | "无";
    discountNote: string;
    packageLengthCm: string;
    packageWidthCm: string;
    packageHeightCm: string;
    packageWeightKg: string;
    mainProcess: string;
    factoryLocation: string;
    factoryContact: string;
    factoryPhone: string;
  }>({
    productName: "",
    category: "",
    productUnitPrice: "",
    moq: "",
    discountPolicy: "",
    discountNote: "",
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    packageWeightKg: "",
    mainProcess: "",
    factoryLocation: "",
    factoryContact: "",
    factoryPhone: "",
  });
  const [inquiryActionLoading, setInquiryActionLoading] = useState<null | "save" | "submit">(null);
  const [inquiryEditingId, setInquiryEditingId] = useState<number | null>(null);
  const [inquiryEditingStatus, setInquiryEditingStatus] = useState("");
  const [inquiryAssignOpen, setInquiryAssignOpen] = useState(false);
  const [inquiryAssignUnits, setInquiryAssignUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [inquiryAssignRecordId, setInquiryAssignRecordId] = useState<number | null>(null);
  const [inquiryAssignForm, setInquiryAssignForm] = useState<{
    productName: string;
    category: string;
    productUnitPrice: string;
    moq: string;
    discountPolicy: "" | "有" | "无";
    discountNote: string;
    packageLengthCm: string;
    packageWidthCm: string;
    packageHeightCm: string;
    packageWeightKg: string;
    mainProcess: string;
    factoryLocation: string;
    factoryContact: string;
    factoryPhone: string;
  }>({
    productName: "",
    category: "",
    productUnitPrice: "",
    moq: "",
    discountPolicy: "",
    discountNote: "",
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    packageWeightKg: "",
    mainProcess: "",
    factoryLocation: "",
    factoryContact: "",
    factoryPhone: "",
  });
  const [inquiryAssignPerson, setInquiryAssignPerson] = useState("");
  const [inquiryAssigneeOptions, setInquiryAssigneeOptions] = useState<{ username: string; displayName: string }[]>(
    [],
  );
  const [inquiryAssigneeLoading, setInquiryAssigneeLoading] = useState(false);
  const [inquiryAssignSaving, setInquiryAssignSaving] = useState(false);

  const operatorName = useMemo(() => {
    const name = session?.user?.name;
    const username = session?.user?.username;
    return typeof name === "string" && name.trim() ? name.trim() : typeof username === "string" ? username : "";
  }, [session?.user?.name, session?.user?.username]);

  useEffect(() => {
    setFilters({});
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryUnits("cmkg");
    setInquiryForm({
      productName: "",
      category: "",
      productUnitPrice: "",
      moq: "",
      discountPolicy: "",
      discountNote: "",
      packageLengthCm: "",
      packageWidthCm: "",
      packageHeightCm: "",
      packageWeightKg: "",
      mainProcess: "",
      factoryLocation: "",
      factoryContact: "",
      factoryPhone: "",
    });
    setInquiryActionLoading(null);
    setInquiryEditingId(null);
    setInquiryEditingStatus("");
    setInquiryAssignOpen(false);
    setInquiryAssignUnits("cmkg");
    setInquiryAssignRecordId(null);
    setInquiryAssignForm({
      productName: "",
      category: "",
      productUnitPrice: "",
      moq: "",
      discountPolicy: "",
      discountNote: "",
      packageLengthCm: "",
      packageWidthCm: "",
      packageHeightCm: "",
      packageWeightKg: "",
      mainProcess: "",
      factoryLocation: "",
      factoryContact: "",
      factoryPhone: "",
    });
    setInquiryAssignPerson("");
    setInquiryAssigneeOptions([]);
    setInquiryAssigneeLoading(false);
    setInquiryAssignSaving(false);
    setUploadingField(null);
    setImageIndexByField({});
    setLinkDraftByField({});
  }, [workspaceKey]);

  useEffect(() => {
    if (editing) return;
    setLinkDraftByField({});
  }, [editing]);

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
      const base = schema.fields.filter((f) => !PURCHASE_UI_HIDDEN_FIELDS.has(f));
      const toInsert = PURCHASE_PRODUCT_SIZE_FIELDS.filter((f) => base.includes(f));
      if (toInsert.length === 0) return base;
      const toInsertSet = new Set<string>(toInsert);
      const withoutInserted = base.filter((f) => !toInsertSet.has(f));
      const idx = withoutInserted.indexOf("所属类目");
      if (idx < 0) return [...withoutInserted, ...toInsert];
      return [...withoutInserted.slice(0, idx + 1), ...toInsert, ...withoutInserted.slice(idx + 1)];
    }
    if (workspaceKey === "ops.inquiry") {
      return schema.fields.filter((f) => !INQUIRY_UI_HIDDEN_FIELDS.has(f));
    }
    return schema.fields;
  }, [schema, workspaceKey]);

  const tableFields = useMemo(() => {
    if (!schema) return [];
    if (workspaceKey === "ops.purchase") {
      return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f) && !PURCHASE_TABLE_HIDDEN_FIELDS.has(f));
    }
    if (workspaceKey === "ops.inquiry") {
      return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f) && !INQUIRY_TABLE_HIDDEN_FIELDS.has(f));
    }
    return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f));
  }, [schema, visibleFields, workspaceKey]);

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
        if ((workspaceKey === "ops.purchase" || workspaceKey === "ops.inquiry") && timeRange) qs.set("timeRange", timeRange);
        const s = qs.toString();
        url = s ? `${base}?${s}` : base;
      }
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setRecords(json.records ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters, q, schema, timeRange, visibleFields, workspaceKey]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    if (!schema) return;
    const data: Record<string, string> = {};
    for (const f of schema.fields) data[f] = getDefaultFieldValue(f);
    if (schema.fields.includes("运营人员") && operatorName) data["运营人员"] = operatorName;
    if (schema.fields.includes("状态")) data["状态"] = INQUIRY_STATUS_VALUE;
    const drafts: Record<string, string[]> = {};
    if (schema.fields.includes("参考链接")) {
      const links = parseDelimitedValues(data["参考链接"] ?? "");
      drafts["参考链接"] = links.length > 0 ? links : [""];
    }
    if (schema.fields.includes("产品规格")) {
      const specs = parseDelimitedValues(data["产品规格"] ?? "");
      drafts["产品规格"] = specs.length > 0 ? specs : [""];
    }
    setLinkDraftByField(drafts);
    setEditing({ id: null, data: applyComputedFields(schema, data) });
  }

  function openInquiryCreate() {
    setEditing(null);
    setInquiryUnits("cmkg");
    setInquiryEditingId(null);
    setInquiryEditingStatus("");
    setInquiryForm({
      productName: (filters["名称"] ?? "").trim(),
      category: "",
      productUnitPrice: "",
      moq: "",
      discountPolicy: "",
      discountNote: "",
      packageLengthCm: "",
      packageWidthCm: "",
      packageHeightCm: "",
      packageWeightKg: "",
      mainProcess: "",
      factoryLocation: "",
      factoryContact: "",
      factoryPhone: "",
    });
    setInquiryActionLoading(null);
    setInquiryCreateOpen(true);
  }

  async function saveInquiryPurchase(status: "待确品" | "已确品", action: "save" | "submit") {
    if (inquiryActionLoading) return;
    setInquiryActionLoading(action);
    try {
      const category = inquiryForm.category.trim();
      const unitPrice = inquiryForm.productUnitPrice.trim();
      const moq = inquiryForm.moq.trim();
      const discountPolicy = inquiryForm.discountPolicy.trim();
      const discountNote = inquiryForm.discountNote.trim();
      const resolvedStatus =
        inquiryEditingId != null && action === "save" ? inquiryEditingStatus.trim() || status : status;

      const data: Record<string, unknown> = {
        名称: inquiryForm.productName,
        "包裹尺寸-长（厘米）": inquiryForm.packageLengthCm,
        "包裹尺寸-宽（厘米）": inquiryForm.packageWidthCm,
        "包裹尺寸-高（厘米）": inquiryForm.packageHeightCm,
        "包裹实重（公斤）": inquiryForm.packageWeightKg,
        主要工艺: inquiryForm.mainProcess,
        工厂所在地: inquiryForm.factoryLocation,
        工厂联系人: inquiryForm.factoryContact,
        联系人电话: inquiryForm.factoryPhone,
        状态: resolvedStatus,
      };
      if (category) data["所属类目"] = category;
      if (unitPrice) data["产品单价"] = unitPrice;
      if (moq) data["起订量"] = moq;
      if (discountPolicy) data["优惠政策"] = discountPolicy;
      if (discountPolicy === "有" && discountNote) data["优惠政策备注"] = discountNote;
      if (operatorName) data["运营人员"] = operatorName;

      const endpointBase = `/api/workspace/${encodeURIComponent("ops.purchase")}/records`;
      const url = inquiryEditingId != null ? `${endpointBase}/${inquiryEditingId}` : endpointBase;
      const res = await fetch(url, {
        method: inquiryEditingId != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "保存失败");
        return;
      }
      setInquiryCreateOpen(false);
      setInquiryEditingId(null);
      setInquiryEditingStatus("");
      await load();
    } finally {
      setInquiryActionLoading(null);
    }
  }

  const isAdmin = session?.user?.permissionLevel != null && session.user.permissionLevel !== "user";
  const currentUsername = typeof session?.user?.username === "string" ? session.user.username : "";

  function canSeeInquiryAssign(row: RecordRow) {
    if (workspaceKey !== "ops.inquiry") return false;
    if (isAdmin) return true;
    const obj = toRecordStringUnknown(row.data);
    const owner = String(obj["询价负责人"] ?? "").trim();
    if (!owner) return false;
    if (currentUsername && owner === currentUsername) return true;
    if (operatorName && owner === operatorName) return true;
    return false;
  }

  async function ensureInquiryAssigneesLoaded() {
    if (inquiryAssigneeLoading) return;
    if (inquiryAssigneeOptions.length > 0) return;
    setInquiryAssigneeLoading(true);
    try {
      const res = await fetch("/api/ops/inquiry/assign", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "加载询价人失败");
        return;
      }
      const raw = json && typeof json === "object" && "users" in json ? (json as { users?: unknown }).users : null;
      if (!Array.isArray(raw)) {
        setInquiryAssigneeOptions([]);
        return;
      }
      const list: { username: string; displayName: string }[] = [];
      for (const it of raw) {
        const u = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
        const username = u && typeof u.username === "string" ? u.username : "";
        const displayName = u && typeof u.displayName === "string" ? u.displayName : "";
        if (!username) continue;
        list.push({ username, displayName: displayName || username });
      }
      setInquiryAssigneeOptions(list);
    } finally {
      setInquiryAssigneeLoading(false);
    }
  }

  function openInquiryAssign(row: RecordRow) {
    if (workspaceKey !== "ops.inquiry") return;
    const obj = toRecordStringUnknown(row.data);
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignUnits("cmkg");
    setInquiryAssignRecordId(row.id);
    setInquiryAssignForm({
      productName: String(obj["名称"] ?? ""),
      category: String(obj["所属类目"] ?? ""),
      productUnitPrice: String(obj["产品单价"] ?? ""),
      moq: String(obj["起订量"] ?? ""),
      discountPolicy: ((obj["优惠政策"] ?? "") as "" | "有" | "无") || "",
      discountNote: String(obj["优惠政策备注"] ?? ""),
      packageLengthCm: String(obj["包裹尺寸-长（厘米）"] ?? ""),
      packageWidthCm: String(obj["包裹尺寸-宽（厘米）"] ?? ""),
      packageHeightCm: String(obj["包裹尺寸-高（厘米）"] ?? ""),
      packageWeightKg: String(obj["包裹实重（公斤）"] ?? ""),
      mainProcess: String(obj["主要工艺"] ?? ""),
      factoryLocation: String(obj["工厂所在地"] ?? ""),
      factoryContact: String(obj["工厂联系人"] ?? ""),
      factoryPhone: String(obj["联系人电话"] ?? ""),
    });
    setInquiryAssignPerson(String(obj["询价人"] ?? ""));
    setInquiryAssignSaving(false);
    setInquiryAssignOpen(true);
    void ensureInquiryAssigneesLoaded();
  }

  async function saveInquiryAssign() {
    if (inquiryAssignSaving) return;
    if (!inquiryAssignRecordId) return;
    const assignee = inquiryAssignPerson.trim();
    if (!assignee) {
      alert("请选择询价人");
      return;
    }
    setInquiryAssignSaving(true);
    try {
      const res = await fetch("/api/ops/inquiry/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: inquiryAssignRecordId, assigneeUsername: assignee }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "分配失败");
        return;
      }
      setInquiryAssignOpen(false);
      setInquiryAssignRecordId(null);
      await load();
    } finally {
      setInquiryAssignSaving(false);
    }
  }

  function openEdit(row: RecordRow) {
    if (workspaceKey === "ops.inquiry") {
      const obj = toRecordStringUnknown(row.data);
      setEditing(null);
      setInquiryUnits("cmkg");
      setInquiryEditingId(row.id);
      setInquiryEditingStatus(String(obj["状态"] ?? ""));
      setInquiryForm({
        productName: String(obj["名称"] ?? ""),
        category: String(obj["所属类目"] ?? ""),
        productUnitPrice: String(obj["产品单价"] ?? ""),
        moq: String(obj["起订量"] ?? ""),
        discountPolicy: ((obj["优惠政策"] ?? "") as "" | "有" | "无") || "",
        discountNote: String(obj["优惠政策备注"] ?? ""),
        packageLengthCm: String(obj["包裹尺寸-长（厘米）"] ?? ""),
        packageWidthCm: String(obj["包裹尺寸-宽（厘米）"] ?? ""),
        packageHeightCm: String(obj["包裹尺寸-高（厘米）"] ?? ""),
        packageWeightKg: String(obj["包裹实重（公斤）"] ?? ""),
        mainProcess: String(obj["主要工艺"] ?? ""),
        factoryLocation: String(obj["工厂所在地"] ?? ""),
        factoryContact: String(obj["工厂联系人"] ?? ""),
        factoryPhone: String(obj["联系人电话"] ?? ""),
      });
      setInquiryActionLoading(null);
      setInquiryCreateOpen(true);
      return;
    }
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
    if (schema.fields.includes("状态")) data["状态"] = INQUIRY_STATUS_VALUE;
    const drafts: Record<string, string[]> = {};
    if (schema.fields.includes("参考链接")) {
      const links = parseDelimitedValues(data["参考链接"] ?? "");
      drafts["参考链接"] = links.length > 0 ? links : [""];
    }
    if (schema.fields.includes("产品规格")) {
      const specs = parseDelimitedValues(data["产品规格"] ?? "");
      drafts["产品规格"] = specs.length > 0 ? specs : [""];
    }
    setLinkDraftByField(drafts);
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

    const operatorValue = operatorName;

    for (const f of visibleFields) {
      if (f === "创建时间" || f === "最后更新时间") continue;
      if (f === "运营人员") continue;
      const v = (editing.data[f] ?? "").trim();
      const kind = getFieldKind(f);
      if (kind === "url" && v) {
        const parts = parseDelimitedValues(v);
        const invalid = parts.find((it) => !looksLikeUrl(it));
        if (invalid) {
          alert(`${displayFieldLabel(f)} 需要以 http:// 或 https:// 开头`);
          return;
        }
      }
      if (kind === "number" && v && !Number.isFinite(Number(v))) {
        alert(`${displayFieldLabel(f)} 需要是数字`);
        return;
      }
      if (kind === "category" && v && categories.length > 0 && !categories.includes(v)) {
        alert(`${displayFieldLabel(f)} 请选择已配置的类目`);
        return;
      }
      if (kind === "yesno" && v && v !== "是" && v !== "否") {
        alert(`${displayFieldLabel(f)} 只能选择“是”或“否”`);
        return;
      }
    }

    const payload: Record<string, unknown> = {};
    for (const f of schema.fields) payload[f] = editing.data[f] ?? "";
    if (schema.fields.includes("运营人员") && operatorValue) payload["运营人员"] = operatorValue;
    if (schema.fields.includes("状态")) payload["状态"] = INQUIRY_STATUS_VALUE;
    if (!editing.id && schema.fields.includes("创建时间")) payload["创建时间"] = formatNow();
    if (schema.fields.includes("最后更新时间")) payload["最后更新时间"] = editing.id ? formatNow() : null;

    if (schema.fields.includes("产品规则") && schema.fields.includes("产品规格")) {
      const rawSpecs =
        linkDraftByField["产品规格"] ?? parseDelimitedValues(String(payload["产品规格"] ?? ""));
      const specs: string[] = [];
      const seen = new Set<string>();
      for (const it of rawSpecs) {
        const t = it.trim();
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        specs.push(t);
      }

      if (specs.length > 0) {
        const baseUrl = `/api/workspace/${encodeURIComponent(workspaceKey)}/records`;
        for (const spec of specs) {
          const dataForSpec: Record<string, unknown> = {
            ...payload,
            产品规格: spec,
            产品规则: spec,
          };
          const res = await fetch(baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: dataForSpec }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            const err =
              json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
            alert(typeof err === "string" && err.trim() ? `${spec}：${err}` : `规格 ${spec} 保存失败`);
            return;
          }
        }

        setEditing(null);
        await load();
        return;
      }
    }

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
    const excluded = new Set([
      "产品图片",
      "参考链接",
      "产品链接×",
      "平台在售价格（Min）",
      "平台在售价格（Max）",
      "状态",
      "选品人",
      "询价分配人｜选品",
      "产品重量",
      "产品规则",
      "运营人员",
      "创建时间",
      "最后更新时间",
      "产品规格",
      "产品规格输入方式",
      "预计周平均日销量",
      "资质要求",
      "是否有专利风险",
    ]);
    if (workspaceKey === "ops.purchase") {
      for (const f of PURCHASE_PRODUCT_SIZE_FIELDS) excluded.add(f);
    }
    if (workspaceKey === "ops.inquiry") {
      excluded.add("选品逻辑");
    }
    const list = visibleFields.slice(0, 12);
    return list.filter((f) => !excluded.has(f));
  }, [schema, visibleFields, workspaceKey]);

  type EditModalShellProps = {
    title: ReactNode;
    dataEditModal: string;
    onClose: () => void;
    children: ReactNode;
  };

  function EditModalShell({ title, dataEditModal, onClose, children }: EditModalShellProps) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-edit-modal={dataEditModal}>
        <div className="w-full max-w-4xl rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{title}</div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
              title="关闭"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  }

  function InquiryEditModal({ title, body }: { title: string; body: ReactNode }) {
    return (
      <EditModalShell title={title} dataEditModal="inquiry" onClose={() => setEditing(null)}>
        {body}
      </EditModalShell>
    );
  }

  function DefaultEditModal({ title, dataEditModal, body }: { title: string; dataEditModal: string; body: ReactNode }) {
    return (
      <EditModalShell title={title} dataEditModal={dataEditModal} onClose={() => setEditing(null)}>
        {body}
      </EditModalShell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">{groupLabel}</div>
          <div className="mt-1 truncate text-lg font-semibold">{schema?.title ?? title}</div>
        </div>
        <div className="flex items-center gap-2">
          {schema ? (
            <>
              {hideInquiryCreateButton ? null : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  onClick={openInquiryCreate}
                >
                  新增询价数据
                </button>
              )}
              {hideCreateButton ? null : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  onClick={openCreate}
                >
                  {createButtonLabel}
                </button>
              )}
            </>
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
              <div className={["grid gap-3", workspaceKey === "ops.inquiry" ? "sm:grid-cols-4" : "sm:grid-cols-3"].join(" ")}>
                {filterFields.map((f) => (
                  workspaceKey === "ops.inquiry" && (f === "名称" || f === "所属类目") ? (
                    <div key={f} className="flex flex-col gap-1">
                      <div className="text-xs text-muted">{displayFieldLabel(f)}</div>
                      <input
                        value={filters[f] ?? ""}
                        onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}
                        placeholder={displayFieldLabel(f)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                  ) : (
                    <input
                      key={f}
                      value={filters[f] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}
                      placeholder={displayFieldLabel(f)}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    />
                  )
                ))}
                {workspaceKey === "ops.inquiry" ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">状态</div>
                    <select
                      value={filters["状态"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 状态: e.target.value }))}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value={INQUIRY_STATUS_VALUE}>{INQUIRY_STATUS_VALUE}</option>
                      <option value="待询价">待询价</option>
                      <option value="待确品">待确品</option>
                      <option value="待分配【采购】">待分配【采购】</option>
                      <option value="待采购">待采购</option>
                      <option value="已到仓">已到仓</option>
                    </select>
                  </div>
                ) : null}
                {workspaceKey === "ops.inquiry" ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => setTimeRange(e.target.value as "" | "today" | "7d" | "30d")}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                    </select>
                  </div>
                ) : (
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as "" | "today" | "7d" | "30d")}
                    className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                  >
                    <option value="">请选择</option>
                    <option value="today">今天</option>
                    <option value="7d">7日内</option>
                    <option value="30d">30天内</option>
                  </select>
                )}
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={loading}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
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
                      {tableFields.map((f) => (
                        <th key={f} className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          {displayFieldLabel(f)}
                        </th>
                      ))}
                      <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {records.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-sm text-muted" colSpan={tableFields.length + 1}>
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => {
                        const obj = toRecordStringUnknown(row.data);
                        return (
                          <tr key={row.id} className="border-b border-border">
                            {tableFields.map((f) => {
                              const v = obj[f] == null ? "" : String(obj[f]);
                              const kind = getFieldKind(f);
                              const imageUrls = kind === "image" ? parseImageUrls(v) : [];
                              const firstImageUrl = imageUrls[0] ?? "";
                              return (
                                <td
                                  key={f}
                                  className={
                                    kind === "image"
                                      ? "border-b border-border px-3 py-2"
                                      : "max-w-[220px] truncate border-b border-border px-3 py-2 text-muted"
                                  }
                                >
                                  {kind === "image" && firstImageUrl && looksLikeImagePath(firstImageUrl) ? (
                                    <a
                                      href={firstImageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 text-foreground"
                                      title={imageUrls.join("\n")}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.open(firstImageUrl, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={displayFieldLabel(f)}
                                        width={40}
                                        height={40}
                                        className="h-10 w-10 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                      <span className="text-xs underline">
                                        {imageUrls.length > 1 ? `查看（${imageUrls.length}）` : "查看"}
                                      </span>
                                    </a>
                                  ) : kind === "url" ? (
                                    (() => {
                                      const urlList = parseDelimitedValues(v).filter(looksLikeUrl);
                                      const first = urlList[0] ?? "";
                                      if (!first) return v || "—";
                                      return (
                                        <a
                                          className="text-foreground underline"
                                          href={first}
                                          target="_blank"
                                          rel="noreferrer"
                                          title={urlList.join("\n")}
                                        >
                                          {urlList.length > 1 ? `链接（${urlList.length}）` : "链接"}
                                        </a>
                                      );
                                    })()
                                  ) : (
                                    v || "—"
                                  )}
                                </td>
                              );
                            })}
                            <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                  onClick={() => openEdit(row)}
                                >
                                  修改
                                </button>
                                {canSeeInquiryAssign(row) ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                    onClick={() => openInquiryAssign(row)}
                                  >
                                    分配
                                  </button>
                                ) : null}
                              </div>
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
                          {canSeeInquiryAssign(row) ? (
                            <button
                              type="button"
                              className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                              title="分配"
                              onClick={() => openInquiryAssign(row)}
                            >
                              分
                            </button>
                          ) : null}
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

      {inquiryCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                {inquiryEditingId != null ? `修改询价数据（ID: ${inquiryEditingId}）` : "新增询价数据"}
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                title="关闭"
                onClick={() => {
                  setInquiryCreateOpen(false);
                  setInquiryEditingId(null);
                  setInquiryEditingStatus("");
                }}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-sm font-medium">基本信息</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">商品名称</div>
                      <input
                        value={inquiryForm.productName}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, productName: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">所属类目</div>
                      <input
                        list="inquiry-category-options"
                        value={inquiryForm.category}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, category: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        placeholder="请选择或输入"
                      />
                      <datalist id="inquiry-category-options">
                        {categories.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">包裹参数</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={[
                          "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs",
                          inquiryUnits === "cmkg"
                            ? "border-primary bg-surface text-primary"
                            : "border-border bg-surface hover:bg-surface-2 text-muted",
                        ].join(" ")}
                        onClick={() => setInquiryUnits("cmkg")}
                      >
                        cm/kg
                      </button>
                      <button
                        type="button"
                        className={[
                          "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs",
                          inquiryUnits === "inlb"
                            ? "border-primary bg-surface text-primary"
                            : "border-border bg-surface hover:bg-surface-2 text-muted",
                        ].join(" ")}
                        onClick={() => setInquiryUnits("inlb")}
                      >
                        英寸/英镑
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">包裹尺寸（长 / 宽 / 高，{inquiryUnits === "cmkg" ? "cm" : "in"}）</div>
                      <div className="flex gap-2">
                        <input
                          inputMode="decimal"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageLengthCm
                              : (cmToInchesValue(inquiryForm.packageLengthCm) ?? "")
                          }
                          onChange={(e) => {
                            const next = e.target.value;
                            setInquiryForm((prev) => {
                              if (inquiryUnits === "cmkg") return { ...prev, packageLengthCm: next };
                              const t = next.trim();
                              if (!t) return { ...prev, packageLengthCm: "" };
                              const cm = inchesToCmValue(next);
                              if (cm == null) return prev;
                              return { ...prev, packageLengthCm: cm };
                            });
                          }}
                          placeholder="长"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                        <input
                          inputMode="decimal"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageWidthCm
                              : (cmToInchesValue(inquiryForm.packageWidthCm) ?? "")
                          }
                          onChange={(e) => {
                            const next = e.target.value;
                            setInquiryForm((prev) => {
                              if (inquiryUnits === "cmkg") return { ...prev, packageWidthCm: next };
                              const t = next.trim();
                              if (!t) return { ...prev, packageWidthCm: "" };
                              const cm = inchesToCmValue(next);
                              if (cm == null) return prev;
                              return { ...prev, packageWidthCm: cm };
                            });
                          }}
                          placeholder="宽"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                        <input
                          inputMode="decimal"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageHeightCm
                              : (cmToInchesValue(inquiryForm.packageHeightCm) ?? "")
                          }
                          onChange={(e) => {
                            const next = e.target.value;
                            setInquiryForm((prev) => {
                              if (inquiryUnits === "cmkg") return { ...prev, packageHeightCm: next };
                              const t = next.trim();
                              if (!t) return { ...prev, packageHeightCm: "" };
                              const cm = inchesToCmValue(next);
                              if (cm == null) return prev;
                              return { ...prev, packageHeightCm: cm };
                            });
                          }}
                          placeholder="高"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">包裹重量（{inquiryUnits === "cmkg" ? "kg" : "lb"}）</div>
                      <input
                        inputMode="decimal"
                        value={
                          inquiryUnits === "cmkg"
                            ? inquiryForm.packageWeightKg
                            : (kgToLbValue(inquiryForm.packageWeightKg) ?? "")
                        }
                        onChange={(e) => {
                          const next = e.target.value;
                          setInquiryForm((prev) => {
                            if (inquiryUnits === "cmkg") return { ...prev, packageWeightKg: next };
                            const t = next.trim();
                            if (!t) return { ...prev, packageWeightKg: "" };
                            const kg = lbToKgValue(next);
                            if (kg == null) return prev;
                            return { ...prev, packageWeightKg: kg };
                          });
                        }}
                        placeholder="请输入重量"
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-sm font-medium">商务信息</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">产品单价</div>
                      <input
                        inputMode="decimal"
                        value={inquiryForm.productUnitPrice}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, productUnitPrice: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">起订量</div>
                      <input
                        inputMode="numeric"
                        value={inquiryForm.moq}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, moq: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">优惠政策</div>
                      <select
                        value={inquiryForm.discountPolicy}
                        onChange={(e) => {
                          const next = (e.target.value as "" | "有" | "无") || "";
                          setInquiryForm((prev) => ({
                            ...prev,
                            discountPolicy: next,
                            discountNote: next === "有" ? prev.discountNote : "",
                          }));
                        }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      >
                        <option value="">请选择</option>
                        <option value="有">有</option>
                        <option value="无">无</option>
                      </select>
                    </div>
                    {inquiryForm.discountPolicy === "有" ? (
                      <div className="flex flex-col gap-1 sm:col-span-2">
                        <div className="text-xs text-muted">优惠备注</div>
                        <textarea
                          value={inquiryForm.discountNote}
                          onChange={(e) => setInquiryForm((prev) => ({ ...prev, discountNote: e.target.value }))}
                          rows={3}
                          className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-sm font-medium">工厂信息</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">主要工艺</div>
                      <select
                        value={inquiryForm.mainProcess}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, mainProcess: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      >
                        <option value="">请选择</option>
                        {MAIN_PROCESS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">工厂所在地</div>
                      <input
                        value={inquiryForm.factoryLocation}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, factoryLocation: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">联系人</div>
                      <input
                        value={inquiryForm.factoryContact}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, factoryContact: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">联系人电话</div>
                      <input
                        value={inquiryForm.factoryPhone}
                        onChange={(e) => setInquiryForm((prev) => ({ ...prev, factoryPhone: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                onClick={() => {
                  setInquiryCreateOpen(false);
                  setInquiryEditingId(null);
                  setInquiryEditingStatus("");
                }}
                disabled={inquiryActionLoading != null}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                onClick={() => saveInquiryPurchase("待确品", "save")}
                disabled={inquiryActionLoading != null}
              >
                {inquiryActionLoading === "save" ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                onClick={() => saveInquiryPurchase("已确品", "submit")}
                disabled={inquiryActionLoading != null}
              >
                {inquiryActionLoading === "submit" ? "提交中…" : "提交"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {inquiryAssignOpen ? (
        <EditModalShell
          title={inquiryAssignRecordId != null ? `询价分配（ID: ${inquiryAssignRecordId}）` : "询价分配"}
          dataEditModal="inquiry-assign"
          onClose={() => {
            setInquiryAssignOpen(false);
            setInquiryAssignRecordId(null);
            setInquiryAssignPerson("");
          }}
        >
          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">基本信息</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={inquiryAssignForm.productName}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <input
                      value={inquiryAssignForm.category}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <div className="text-xs text-muted">询价人</div>
                    <select
                      value={inquiryAssignPerson}
                      onChange={(e) => setInquiryAssignPerson(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      disabled={inquiryAssigneeLoading}
                    >
                      <option value="">请选择</option>
                      {inquiryAssigneeOptions.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">包裹参数</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={[
                        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs",
                        inquiryAssignUnits === "cmkg"
                          ? "border-primary bg-surface text-primary"
                          : "border-border bg-surface hover:bg-surface-2 text-muted",
                      ].join(" ")}
                      onClick={() => setInquiryAssignUnits("cmkg")}
                    >
                      cm/kg
                    </button>
                    <button
                      type="button"
                      className={[
                        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs",
                        inquiryAssignUnits === "inlb"
                          ? "border-primary bg-surface text-primary"
                          : "border-border bg-surface hover:bg-surface-2 text-muted",
                      ].join(" ")}
                      onClick={() => setInquiryAssignUnits("inlb")}
                    >
                      英寸/英镑
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">包裹尺寸（长 / 宽 / 高，{inquiryAssignUnits === "cmkg" ? "cm" : "in"}）</div>
                    <div className="flex gap-2">
                      <input
                        inputMode="decimal"
                        value={
                          inquiryAssignUnits === "cmkg"
                            ? inquiryAssignForm.packageLengthCm
                            : (cmToInchesValue(inquiryAssignForm.packageLengthCm) ?? "")
                        }
                        disabled
                        placeholder="长"
                        className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                      />
                      <input
                        inputMode="decimal"
                        value={
                          inquiryAssignUnits === "cmkg"
                            ? inquiryAssignForm.packageWidthCm
                            : (cmToInchesValue(inquiryAssignForm.packageWidthCm) ?? "")
                        }
                        disabled
                        placeholder="宽"
                        className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                      />
                      <input
                        inputMode="decimal"
                        value={
                          inquiryAssignUnits === "cmkg"
                            ? inquiryAssignForm.packageHeightCm
                            : (cmToInchesValue(inquiryAssignForm.packageHeightCm) ?? "")
                        }
                        disabled
                        placeholder="高"
                        className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">包裹重量（{inquiryAssignUnits === "cmkg" ? "kg" : "lb"}）</div>
                    <input
                      inputMode="decimal"
                      value={
                        inquiryAssignUnits === "cmkg"
                          ? inquiryAssignForm.packageWeightKg
                          : (kgToLbValue(inquiryAssignForm.packageWeightKg) ?? "")
                      }
                      disabled
                      placeholder="请输入重量"
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">商务信息</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">产品单价</div>
                    <input
                      inputMode="decimal"
                      value={inquiryAssignForm.productUnitPrice}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">起订量</div>
                    <input
                      inputMode="numeric"
                      value={inquiryAssignForm.moq}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">优惠政策</div>
                    <select
                      value={inquiryAssignForm.discountPolicy}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    >
                      <option value="">请选择</option>
                      <option value="有">有</option>
                      <option value="无">无</option>
                    </select>
                  </div>
                  {inquiryAssignForm.discountPolicy === "有" ? (
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <div className="text-xs text-muted">优惠备注</div>
                      <textarea
                        value={inquiryAssignForm.discountNote}
                        disabled
                        rows={3}
                        className="w-full cursor-not-allowed resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none opacity-70"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">工厂信息</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">主要工艺</div>
                    <select
                      value={inquiryAssignForm.mainProcess}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    >
                      <option value="">请选择</option>
                      {MAIN_PROCESS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">工厂所在地</div>
                    <input
                      value={inquiryAssignForm.factoryLocation}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">联系人</div>
                    <input
                      value={inquiryAssignForm.factoryContact}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">联系人电话</div>
                    <input
                      value={inquiryAssignForm.factoryPhone}
                      disabled
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setInquiryAssignOpen(false);
                setInquiryAssignRecordId(null);
                setInquiryAssignPerson("");
              }}
              disabled={inquiryAssignSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
              onClick={saveInquiryAssign}
              disabled={inquiryAssignSaving || inquiryAssigneeLoading}
            >
              {inquiryAssignSaving ? "提交中…" : "确认分配"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {editing ? (
        (() => {
          const body = (
            <>
              {schema ? (
              <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
                {(() => {
                  const fields = visibleFields.filter(
                    (f) => f !== "创建时间" && f !== "最后更新时间" && f !== "运营人员" && f !== "状态",
                  );

                  const isPurchaseFlow =
                    workspaceKey === "ops.purchase" || workspaceKey === "ops.inquiry" || workspaceKey === "ops.pricing";

                  const renderField = (f: string, opts?: { hideLabel?: boolean; wrapperClassName?: string }) => {
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

                    const isMainProductImage = isPurchaseFlow && f === "产品图片";
                    const useRowLayout = isPurchaseFlow && !opts?.hideLabel && kind !== "image";
                    if (f === "状态") return null;
                    if (f === "产品规格" && schema.fields.includes("产品规格输入方式")) {
                      const modeField = "产品规格输入方式";
                      const modeRaw = (editing.data[modeField] ?? "").trim();
                      const mode = modeRaw === "合并输入" ? "合并输入" : "分开输入";
                      const list =
                        linkDraftByField[f] ?? (() => {
                          const parsed = parseDelimitedValues(value);
                          return parsed.length > 0 ? parsed : [""];
                        })();
                      const radioName = `spec-input-mode-${editing.id ?? "new"}`;

                      const setMode = (next: "分开输入" | "合并输入") => {
                        setEditing((prev) => {
                          if (!prev) return prev;
                          const nextData: Record<string, string> = {
                            ...prev.data,
                            [modeField]: next,
                          };
                          return { ...prev, data: applyComputedFields(schema, nextData) };
                        });

                        if (next === "分开输入") {
                          const parsed = parseDelimitedValues(value);
                          setLinkDraftByField((prev) => ({ ...prev, [f]: parsed.length > 0 ? parsed : [""] }));
                        } else {
                          setLinkDraftByField((prev) => ({ ...prev, [f]: list.length > 0 ? list : [""] }));
                          setEditing((prev) => {
                            if (!prev) return prev;
                            const nextData: Record<string, string> = {
                              ...prev.data,
                              [f]: joinDelimitedValues(list),
                            };
                            return { ...prev, data: applyComputedFields(schema, nextData) };
                          });
                        }
                      };

                      const rowClassName = useRowLayout
                        ? "flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                        : "flex flex-col gap-1";
                      const labelClassName = `flex items-center gap-1 text-xs text-muted ${useRowLayout ? "sm:w-28 sm:shrink-0" : ""}`;
                      const contentClassName = useRowLayout ? "min-w-0 sm:flex-1" : "";

                      return (
                        <div key={f} className={`flex flex-col gap-2 ${opts?.wrapperClassName ?? ""}`}>
                          <div className={rowClassName}>
                            {opts?.hideLabel ? null : (
                              <div className={labelClassName}>
                                <div className="min-w-0 flex-1 truncate">{displayFieldLabel(f)}</div>
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
                            )}

                            <div className={contentClassName}>
                              {mode === "分开输入" ? (
                                <div className="flex flex-col gap-2">
                                  {list.map((it, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={it}
                                        onChange={(e) => {
                                          const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                        placeholder="请输入规格"
                                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                      />
                                      <button
                                        type="button"
                                        className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                        onClick={() => {
                                          const nextList = list.filter((_, i) => i !== idx);
                                          const normalized = nextList.length > 0 ? nextList : [""];
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: normalized }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                      >
                                        删除
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                    onClick={() => {
                                      const nextList = [...list, ""];
                                      setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                      setValue(joinDelimitedValues(nextList));
                                    }}
                                  >
                                    + 添加规格
                                  </button>
                                </div>
                              ) : (
                                <textarea
                                  value={value}
                                  onChange={(e) => {
                                    const nextValue = e.target.value;
                                    setValue(nextValue);
                                    const parsed = parseDelimitedValues(nextValue);
                                    setLinkDraftByField((prev) => ({ ...prev, [f]: parsed.length > 0 ? parsed : [""] }));
                                  }}
                                  rows={4}
                                  placeholder="请输入规格（可用逗号或换行分隔）"
                                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                                />
                              )}
                            </div>
                          </div>

                          <div className={rowClassName}>
                            {opts?.hideLabel ? null : (
                              <div className={labelClassName}>
                                <div className="min-w-0 flex-1 truncate">录入方式</div>
                              </div>
                            )}
                            <div className={contentClassName}>
                              <div className="flex items-center gap-4 text-sm">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={radioName}
                                    value="split"
                                    checked={mode === "分开输入"}
                                    onChange={() => setMode("分开输入")}
                                  />
                                  <span>分开输入</span>
                                </label>
                                <label className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={radioName}
                                    value="merge"
                                    checked={mode === "合并输入"}
                                    onChange={() => setMode("合并输入")}
                                  />
                                  <span>合并输入</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={f}
                        className={`${useRowLayout ? "flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3" : "flex flex-col gap-1"} ${
                          opts?.wrapperClassName ?? ""
                        }`}
                      >
                        {opts?.hideLabel ? null : (
                          <div
                            className={`flex items-center gap-1 text-xs text-muted ${
                              useRowLayout ? "sm:w-28 sm:shrink-0" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1 truncate">{displayFieldLabel(f)}</div>
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
                        )}

                        {kind === "image" ? (
                          <div className="flex flex-col gap-2">
                            {(() => {
                              const urls = parseImageUrls(value);
                              return (
                                <div className="flex flex-col gap-2">
                                  <div className="min-w-0">
                                    {urls.length > 0 ? (
                                      <div className="text-sm text-muted">{`已上传 ${urls.length} 张`}</div>
                                    ) : null}
                                    {urls.length > 0 ? (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {urls.slice(0, 6).map((u, idx) => (
                                          <button
                                            key={`${u}-${idx}`}
                                            type="button"
                                            className="h-10 w-10 overflow-hidden rounded-md border border-border bg-surface-2 hover:bg-surface"
                                            title={`第 ${idx + 1} 张`}
                                            onClick={() => setImageIndexByField((prev) => ({ ...prev, [f]: idx }))}
                                          >
                                            {looksLikeImagePath(u) ? (
                                              <Image
                                                src={u}
                                                alt={`${displayFieldLabel(f)} ${idx + 1}`}
                                                width={40}
                                                height={40}
                                                className="h-10 w-10 object-cover"
                                              />
                                            ) : (
                                              <span className="text-[10px] text-muted">链接</span>
                                            )}
                                          </button>
                                        ))}
                                        {urls.length > 6 ? <div className="text-xs text-muted">+{urls.length - 6}</div> : null}
                                      </div>
                                    ) : null}
                                  </div>

                                  <label
                                    className={`flex w-full items-center justify-center rounded-lg border border-dashed border-border bg-surface transition-colors hover:bg-surface-2 ${
                                      uploadingField === f ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                                    } ${isMainProductImage ? "h-32" : "h-20"}`}
                                  >
                                    <input
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      disabled={uploadingField === f}
                                      className="hidden"
                                      onChange={async (e) => {
                                        const files = Array.from(e.target.files ?? []);
                                        e.target.value = "";
                                        if (files.length === 0) return;
                                        setUploadingField(f);
                                        try {
                                          const existing = parseImageUrls(value);
                                          const uploaded: string[] = [];
                                          for (const file of files) {
                                            const url = await uploadImage(file);
                                            if (url) uploaded.push(url);
                                          }
                                          if (uploaded.length > 0) {
                                            setValue(joinImageUrls([...existing, ...uploaded]));
                                            setImageIndexByField((prev) => ({ ...prev, [f]: existing.length }));
                                          }
                                        } finally {
                                          setUploadingField(null);
                                        }
                                      }}
                                    />
                                    <div className="flex flex-col items-center gap-1 text-muted">
                                      <div className="text-2xl leading-none">+</div>
                                      <div className="text-xs">{uploadingField === f ? "上传中…" : "添加图片"}</div>
                                    </div>
                                  </label>
                                </div>
                              );
                            })()}

                            {(() => {
                              const urls = parseImageUrls(value);
                              if (urls.length === 0) return null;
                              const currentRaw = imageIndexByField[f] ?? 0;
                              const current = Math.max(0, Math.min(currentRaw, urls.length - 1));
                              const url = urls[current] ?? "";
                              return (
                                <div className="rounded-lg border border-border bg-surface p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs text-muted">
                                      {current + 1}/{urls.length}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={urls.length <= 1}
                                        className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs hover:bg-surface-2 disabled:opacity-50"
                                        onClick={() =>
                                          setImageIndexByField((prev) => ({
                                            ...prev,
                                            [f]: (prev[f] ?? 0) - 1 < 0 ? urls.length - 1 : (prev[f] ?? 0) - 1,
                                          }))
                                        }
                                      >
                                        上一张
                                      </button>
                                      <button
                                        type="button"
                                        disabled={urls.length <= 1}
                                        className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs hover:bg-surface-2 disabled:opacity-50"
                                        onClick={() =>
                                          setImageIndexByField((prev) => ({
                                            ...prev,
                                            [f]: ((prev[f] ?? 0) + 1) % urls.length,
                                          }))
                                        }
                                      >
                                        下一张
                                      </button>
                                      <a
                                        className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs hover:bg-surface-2"
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        打开
                                      </a>
                                    </div>
                                  </div>

                                  <div className="mt-2 flex justify-center">
                                    {looksLikeImagePath(url) ? (
                                      <Image
                                        src={url}
                                        alt={displayFieldLabel(f)}
                                        width={560}
                                        height={560}
                                        className="max-h-56 w-auto max-w-full rounded-md border border-border bg-surface-2 object-contain"
                                      />
                                    ) : (
                                      <a className="text-sm text-foreground underline" href={url} target="_blank" rel="noreferrer">
                                        图片链接
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : kind === "category" ? (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            <select
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                            >
                              <option value="">请选择</option>
                              {value && !categories.includes(value) ? <option value={value}>{value}</option> : null}
                              {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : kind === "yesno" ? (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            {(() => {
                              if (f === "是否有专利风险" && schema.fields.includes("专利情况")) {
                                const descField = "专利情况";
                                const currentYesNo = value || "否";
                                const descValue = editing.data[descField] ?? "";
                                return (
                                  <div className="flex flex-col gap-2">
                                    <select
                                      value={currentYesNo}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        setEditing((prev) => {
                                          if (!prev) return prev;
                                          const nextData: Record<string, string> = {
                                            ...prev.data,
                                            [f]: next,
                                            [descField]: next === "是" ? prev.data[descField] ?? "" : "",
                                          };
                                          return { ...prev, data: applyComputedFields(schema, nextData) };
                                        });
                                      }}
                                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                    >
                                      <option value="否">否</option>
                                      <option value="是">是</option>
                                    </select>
                                    {currentYesNo === "是" ? (
                                      <input
                                        value={descValue}
                                        onChange={(e) =>
                                          setEditing((prev) => {
                                            if (!prev) return prev;
                                            const nextData: Record<string, string> = { ...prev.data, [descField]: e.target.value };
                                            return { ...prev, data: applyComputedFields(schema, nextData) };
                                          })
                                        }
                                        placeholder="请输入风险描述"
                                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                      />
                                    ) : null}
                                  </div>
                                );
                              }
                              return (
                                <select
                                  value={value || "否"}
                                  onChange={(e) => setValue(e.target.value)}
                                  className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                >
                                  <option value="否">否</option>
                                  <option value="是">是</option>
                                </select>
                              );
                            })()}
                          </div>
                        ) : f === "产品规格" ? (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            {(() => {
                              const modeField = "产品规格输入方式";
                              const modeRaw = (schema.fields.includes(modeField) ? editing.data[modeField] : "") ?? "";
                              const mode = modeRaw === "合并输入" ? "合并输入" : "分开输入";
                              const list =
                                mode === "分开输入"
                                  ? linkDraftByField[f] ?? (() => {
                                      const parsed = parseDelimitedValues(value);
                                      return parsed.length > 0 ? parsed : [""];
                                    })()
                                  : [];

                              const setMode = (next: "分开输入" | "合并输入") => {
                                setEditing((prev) => {
                                  if (!prev) return prev;
                                  const nextData: Record<string, string> = {
                                    ...prev.data,
                                    [modeField]: next,
                                  };
                                  return { ...prev, data: applyComputedFields(schema, nextData) };
                                });

                                if (next === "分开输入") {
                                  const parsed = parseDelimitedValues(editing.data[f] ?? "");
                                  setLinkDraftByField((prev) => ({ ...prev, [f]: parsed.length > 0 ? parsed : [""] }));
                                } else {
                                  const currentList =
                                    linkDraftByField[f] ?? (() => {
                                      const parsed = parseDelimitedValues(editing.data[f] ?? "");
                                      return parsed.length > 0 ? parsed : [""];
                                    })();
                                  setEditing((prev) => {
                                    if (!prev) return prev;
                                    const nextData: Record<string, string> = {
                                      ...prev.data,
                                      [f]: joinDelimitedValues(currentList),
                                    };
                                    return { ...prev, data: applyComputedFields(schema, nextData) };
                                  });
                                }
                              };

                              return (
                                <div className="flex flex-col gap-2">
                                  {mode === "分开输入" ? (
                                    <div className="flex flex-col gap-2">
                                      {list.map((it, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                          <input
                                            type="text"
                                            value={it}
                                            onChange={(e) => {
                                              const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                              setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                              setValue(joinDelimitedValues(nextList));
                                            }}
                                            placeholder="请输入规格"
                                            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                          />
                                          <button
                                            type="button"
                                            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                            onClick={() => {
                                              const nextList = list.filter((_, i) => i !== idx);
                                              const normalized = nextList.length > 0 ? nextList : [""];
                                              setLinkDraftByField((prev) => ({ ...prev, [f]: normalized }));
                                              setValue(joinDelimitedValues(nextList));
                                            }}
                                          >
                                            删除
                                          </button>
                                        </div>
                                      ))}
                                      <button
                                        type="button"
                                        className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                        onClick={() => {
                                          const nextList = [...list, ""];
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                      >
                                        + 添加规格
                                      </button>
                                    </div>
                                  ) : (
                                    <textarea
                                      value={value}
                                      onChange={(e) => setValue(e.target.value)}
                                      rows={4}
                                      placeholder="请输入规格（可用逗号或换行分隔）"
                                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                                    />
                                  )}

                                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                                    <div className="text-xs text-muted">录入方式</div>
                                    <div className="flex items-center gap-4 text-sm">
                                      <label className="flex items-center gap-2">
                                        <input
                                          type="radio"
                                          name="spec-input-mode"
                                          value="split"
                                          checked={mode === "分开输入"}
                                          onChange={() => setMode("分开输入")}
                                        />
                                        <span>分开输入</span>
                                      </label>
                                      <label className="flex items-center gap-2">
                                        <input
                                          type="radio"
                                          name="spec-input-mode"
                                          value="merge"
                                          checked={mode === "合并输入"}
                                          onChange={() => setMode("合并输入")}
                                        />
                                        <span>合并输入</span>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : f === "参考链接" ? (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            {(() => {
                              const list = linkDraftByField[f] ?? (() => {
                                const parsed = parseDelimitedValues(value);
                                return parsed.length > 0 ? parsed : [""];
                              })();
                              return (
                                <div className="flex flex-col gap-2">
                                  {list.map((it, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <input
                                        type="url"
                                        value={it}
                                        onChange={(e) => {
                                          const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                      />
                                      <button
                                        type="button"
                                        className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                        onClick={() => {
                                          const nextList = list.filter((_, i) => i !== idx);
                                          const normalized = nextList.length > 0 ? nextList : [""];
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: normalized }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                      >
                                        删除
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                    onClick={() => {
                                      const nextList = [...list, ""];
                                      setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                      setValue(joinDelimitedValues(nextList));
                                    }}
                                  >
                                    + 添加链接
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        ) : f === "选品逻辑" ? (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            {(() => {
                              const options = ["爆款跟卖", "潜力款跟卖", "跨平台搬款", "纯新款推广"];
                              const otherOption = "其他";
                              const raw = value.trim();
                              const isPreset = options.includes(raw);
                              const isOther = raw === otherOption || (!isPreset && raw !== "");
                              const selectValue = raw === "" ? "" : isPreset ? raw : otherOption;
                              const otherValue = isOther && raw !== otherOption ? value : "";
                              return (
                                <div className="flex flex-col gap-2">
                                  <select
                                    value={selectValue}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      if (next === "") {
                                        setValue("");
                                        return;
                                      }
                                      if (next === otherOption) {
                                        if (value.trim() !== "" && !options.includes(value.trim()) && value.trim() !== otherOption) {
                                          setValue(value);
                                          return;
                                        }
                                        setValue(otherOption);
                                        return;
                                      }
                                      setValue(next);
                                    }}
                                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                  >
                                    <option value="">请选择</option>
                                    {options.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                    <option value={otherOption}>{otherOption}</option>
                                  </select>
                                  {selectValue === otherOption ? (
                                    <input
                                      value={otherValue}
                                      onChange={(e) => setValue(e.target.value)}
                                      placeholder="请输入其他选品逻辑"
                                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                    />
                                  ) : null}
                                </div>
                              );
                            })()}
                          </div>
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
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            <input
                              type={kind === "url" ? "url" : kind === "number" ? "number" : "text"}
                              inputMode={kind === "number" ? "decimal" : undefined}
                              value={value}
                              disabled
                              placeholder="自动计算"
                              className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                            />
                          </div>
                        ) : (
                          <div className={useRowLayout ? "min-w-0 sm:flex-1" : ""}>
                            <input
                              type={kind === "url" ? "url" : kind === "number" ? "number" : "text"}
                              inputMode={kind === "number" ? "decimal" : undefined}
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              onWheel={
                                kind === "number"
                                  ? (e) => {
                                      e.currentTarget.blur();
                                    }
                                  : undefined
                              }
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  };

                  if (!isPurchaseFlow) {
                    return <div className="grid gap-3 sm:grid-cols-2">{fields.map((f) => renderField(f))}</div>;
                  }

                  const group2 = ["产品规格"];
                  const group3 = ["预计周平均日销量", "选品逻辑", "状态"];
                  const group4 = ["资质要求", "是否有专利风险"];

                  const renderGroup = (title: string, groupFields: string[], layout: "one" | "two" = "two") => {
                    const list = groupFields.filter((f) => fields.includes(f));
                    if (list.length === 0) return null;
                    return (
                      <div className="rounded-lg border border-border bg-surface p-3">
                        <div className="text-sm font-medium">{title}</div>
                        <div className={layout === "one" ? "mt-3 grid gap-3" : "mt-3 grid gap-3 sm:grid-cols-2"}>
                          {list.map((f) => renderField(f))}
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div className="flex flex-col gap-3">
                      <div className="rounded-lg border border-border bg-surface p-3">
                        <div className="text-sm font-medium">基本信息</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-[11rem,1fr]">
                          {fields.includes("产品图片") ? <div className="sm:row-span-4">{renderField("产品图片")}</div> : null}
                          {fields.includes("名称") ? <div className="sm:col-start-2">{renderField("名称")}</div> : null}
                          {fields.includes("参考链接") ? <div className="sm:col-start-2">{renderField("参考链接")}</div> : null}

                          {fields.includes("平台在售价格（Min）") || fields.includes("平台在售价格（Max）") ? (
                            <div className="sm:col-start-2">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                                <div className="text-xs text-muted sm:w-28 sm:shrink-0">平台在售价格区间</div>
                                <div className="grid gap-3 sm:flex-1 sm:grid-cols-2">
                                  {fields.includes("平台在售价格（Min）") ? renderField("平台在售价格（Min）", { hideLabel: true }) : null}
                                  {fields.includes("平台在售价格（Max）") ? renderField("平台在售价格（Max）", { hideLabel: true }) : null}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {fields.includes("所属类目") ? <div className="sm:col-start-2">{renderField("所属类目")}</div> : null}
                          {(() => {
                            if (
                              !schema.fields.includes("产品尺寸-长（厘米）") ||
                              !schema.fields.includes("产品尺寸-宽（厘米）") ||
                              !schema.fields.includes("产品尺寸-高（厘米）")
                            ) {
                              return null;
                            }
                            const len = editing.data["产品尺寸-长（厘米）"] ?? "";
                            const wid = editing.data["产品尺寸-宽（厘米）"] ?? "";
                            const hei = editing.data["产品尺寸-高（厘米）"] ?? "";
                            const setField = (field: string, next: string) =>
                              setEditing((prev) => {
                                if (!prev) return prev;
                                const nextData: Record<string, string> = { ...prev.data, [field]: next };
                                return { ...prev, data: applyComputedFields(schema, nextData) };
                              });
                            return (
                              <div className="sm:col-start-2">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                                  <div className="text-xs text-muted sm:w-28 sm:shrink-0">产品尺寸（cm）</div>
                                  <div className="grid grid-cols-3 gap-2 sm:flex-1">
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      value={len}
                                      onChange={(e) => setField("产品尺寸-长（厘米）", e.target.value)}
                                      onWheel={(e) => {
                                        e.currentTarget.blur();
                                      }}
                                      placeholder="长"
                                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                    />
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      value={wid}
                                      onChange={(e) => setField("产品尺寸-宽（厘米）", e.target.value)}
                                      onWheel={(e) => {
                                        e.currentTarget.blur();
                                      }}
                                      placeholder="宽"
                                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                    />
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      value={hei}
                                      onChange={(e) => setField("产品尺寸-高（厘米）", e.target.value)}
                                      onWheel={(e) => {
                                        e.currentTarget.blur();
                                      }}
                                      placeholder="高"
                                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {fields.includes("产品重量") ? <div className="sm:col-start-2">{renderField("产品重量")}</div> : null}
                        </div>
                      </div>
                      {renderGroup("规格信息", group2, "one")}
                      {renderGroup("注意事项", group4, "one")}
                      {renderGroup("选品逻辑", group3, "one")}
                    </div>
                  );
                })()}
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
                className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white"
                onClick={saveEdit}
              >
                保存
              </button>
            </div>
            </>
          );

          if (workspaceKey === "ops.inquiry") {
            const title = editing.id ? `询价修改（ID: ${editing.id}）` : "新增询价";
            return <InquiryEditModal title={title} body={body} />;
          }

          const dataEditModal = workspaceKey === "ops.purchase" ? "purchase" : "default";
          const title =
            workspaceKey === "ops.purchase"
              ? editing.id
                ? `选品修改（ID: ${editing.id}）`
                : "新增选品"
              : editing.id
                ? `修改（ID: ${editing.id}）`
                : "新增";

          return <DefaultEditModal title={title} dataEditModal={dataEditModal} body={body} />;
        })()
      ) : null}
    </div>
  );
}
