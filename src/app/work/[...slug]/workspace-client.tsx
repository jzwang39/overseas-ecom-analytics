"use client";

import Image from "next/image";
import { Users, Clock, XCircle, Search, RotateCcw, Check, X, ExternalLink, Plus, Trash2, Paperclip } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getWorkspaceSchema } from "@/lib/workspace/schemas";
import { type PricingEntry, lookupDispatchFeeUsd } from "@/lib/workspace/compute";
import { useSession } from "next-auth/react";

type RecordRow = { id: number; updated_at: string; data: unknown };

type EditModalShellProps = {
  title: ReactNode;
  dataEditModal: string;
  onClose: () => void;
  children: ReactNode;
};

function EditModalShell({ title, dataEditModal, onClose, children }: EditModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-6"
      data-edit-modal={dataEditModal}
      onKeyDown={(e) => {
        const t = e.target as EventTarget | null;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
          e.stopPropagation();
        }
      }}
    >
      <div className="my-auto w-full max-w-4xl rounded-xl border border-border bg-surface p-4">
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

function sanitizeDecimalInput(raw: string) {
  const normalized = raw.replace(/[，。]/g, ".");
  let out = "";
  let dotSeen = false;
  for (const ch of normalized) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    if (ch === "." && !dotSeen) {
      out += ".";
      dotSeen = true;
    }
  }
  if (out.startsWith(".")) return `0${out}`;
  return out;
}

type FieldKind = "text" | "url" | "number" | "image" | "category" | "yesno";

const IMAGE_FIELDS = new Set(["产品图片", "产品实物图", "包裹实物包装图", "发票附件"]);
const URL_FIELDS = new Set(["参考链接", "产品链接×"]);
const INQUIRY_STATUS_VALUE = "待分配【询价】";
const SELECTION_PENDING_STATUS_VALUE = "待选品";
const SELECTION_ABANDON_STATUS_VALUE = "【选品】已放弃";
const MAIN_PROCESS_OPTIONS = ["注塑", "五金", "木制", "缝制", "印刷", "玻璃", "陶瓷", "电子组装", "其他"] as const;
const PRICING_COMPUTED_SUMMARY_FIELDS = [
  "包裹体积（立方厘米）",
  "体积重",
  "包裹计费重",
  "包裹计费重（磅）",
  "尾程成本（人民币）",
  "成本总计",
  "人民币报价",
  "temu核价最低标准（未加2.99）",
  "temu报价",
] as const;

const INQUIRY_COST_SUMMARY_FIELDS = [
  "采购成本",
  "成本总计",
  "人民币报价",
  "temu核价最低标准（未加2.99）",
  "temu报价",
  "temu售价",
] as const;
const INQUIRY_PREVIEW_TWO_DECIMAL_FIELDS = new Set(["尾程成本（人民币）", "成本总计", "负向成本", "人民币报价"]);

function getPricingComputedSummary(data: Record<string, unknown>) {
  const lines: string[] = [];
  for (const field of PRICING_COMPUTED_SUMMARY_FIELDS) {
    const value = String(data[field] ?? "").trim();
    if (!value) continue;
    lines.push(`${field}: ${value}`);
  }
  return lines;
}

function getInquiryCostSummary(data: Record<string, unknown>) {
  const lines: string[] = [];
  for (const field of INQUIRY_COST_SUMMARY_FIELDS) {
    const value = String(data[field] ?? "").trim();
    if (!value) continue;
    lines.push(`${field}: ${value}`);
  }
  return lines;
}

function formatInquiryPreviewValue(field: string, rawValue: string) {
  if (!rawValue) return rawValue;
  if (!INQUIRY_PREVIEW_TWO_DECIMAL_FIELDS.has(field)) return rawValue;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return rawValue;
  return numeric.toFixed(2);
}

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
  "放弃理由",
  "撤回理由",
  "包装尺寸-长（英寸）",
  "包装尺寸-宽（英寸）",
  "包装尺寸-高（英寸）",
  "产品体积",
  "产品实物图",
  "单套尺寸-长（厘米）",
  "单套尺寸-宽（厘米）",
  "单套尺寸-高（厘米）",
  "包裹体积（立方厘米）",
  "体积重系数",
  "体积重",
  "包裹实重（公斤）",
  "包裹计费重",
  "包裹计费重（磅）",
  "单套尺寸-长（英寸）",
  "单套尺寸-宽（英寸）",
  "单套尺寸-高（英寸）",
  "包裹实物包装图",
  "箱规",
  "外箱尺寸-长（厘米）",
  "外箱尺寸-宽（厘米）",
  "外箱尺寸-高（厘米）",
  "外箱体积",
  "外箱体积系数",
  "外箱体积重",
  "外箱实重",
  "外箱计费重",
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
  "派送费",
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
  "产品尺寸列表",
]);

const PURCHASE_PRODUCT_SIZE_FIELDS = ["产品尺寸-长（厘米）", "产品尺寸-宽（厘米）", "产品尺寸-高（厘米）"] as const;
const WORKSPACE_TABLE_HIDDEN_FIELDS = new Set(["产品链接×", "运营人员", "创建时间", "最后更新时间", "放弃理由"]);
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
  "人民币报价",
  "temu核价最低标准（未加2.99）",
]);

const INQUIRY_UI_HIDDEN_FIELDS = new Set([
  "产品规则",
  "产品规格输入方式",
  "放弃理由",
  "海外仓（卸货费）",
  "海外仓（操作费）",
  "派送费",
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
  if (field === "平台在售价格模式") return "text";
  if (isNumericField(field)) return "number";
  return "text";
}

function getDefaultFieldValue(field: string) {
  const kind = getFieldKind(field);
  if (kind === "yesno") return "否";
  if (field === "体积重系数" || field === "外箱体积系数") return "6000";
  if (field === "海外仓（操作费）") return "7.25";
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
  { target: "外箱计费重", a: "外箱体积重", b: "外箱实重" },
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

const DIVIDE_RULES = [
  { target: "体积重", numerator: "包裹体积（立方厘米）", denominator: "体积重系数", digits: 4 },
  { target: "外箱体积重", numerator: "外箱体积", denominator: "外箱体积系数", digits: 4 },
] as const;

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

const RANGE_VALUE_RULES: ReadonlyArray<never> = [];

type RangeValueRule = never;

function getRangeValueRule(_schema: { fields: string[] } | null, _target: string): RangeValueRule | null {
  return null;
}

function mapRangeValue(_raw: string, _rule: RangeValueRule) {
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
  { target: "temu核价最低标准（未加2.99）", source: "成本总计", divisor: 0.6, digits: 2 },
  { target: "temu报价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 2 },
  { target: "temu售价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 2 },
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
  { target: "成本总计", addends: ["采购成本", "头程成本", "尾程成本（人民币）"], factor: 1, digits: 4 },
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
    addends: ["海外仓（卸货费）", "海外仓（操作费）", "派送费"],
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
    return null;
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

function applyComputedFields(schema: { fields: string[] }, data: Record<string, string>, pricingTable: PricingEntry[] = []) {
  const out: Record<string, string> = { ...data };

  // Apply defaults
  if (schema.fields.includes("体积重系数") && !out["体积重系数"]) out["体积重系数"] = "6000";
  if (schema.fields.includes("外箱体积系数") && !out["外箱体积系数"]) out["外箱体积系数"] = "6000";
  if (schema.fields.includes("海外仓（操作费）") && !out["海外仓（操作费）"]) out["海外仓（操作费）"] = "7.25";

  // 包裹体积（立方厘米）= L × W × H
  if (
    schema.fields.includes("包裹体积（立方厘米）") &&
    schema.fields.includes("单套尺寸-长（厘米）") &&
    schema.fields.includes("单套尺寸-宽（厘米）") &&
    schema.fields.includes("单套尺寸-高（厘米）")
  ) {
    const l = toFiniteNumber(out["单套尺寸-长（厘米）"] ?? "");
    const w = toFiniteNumber(out["单套尺寸-宽（厘米）"] ?? "");
    const h = toFiniteNumber(out["单套尺寸-高（厘米）"] ?? "");
    if (l != null && w != null && h != null) {
      out["包裹体积（立方厘米）"] = formatDecimal(l * w * h, 4);
    }
  }

  // 外箱体积 = L × W × H
  if (
    schema.fields.includes("外箱体积") &&
    schema.fields.includes("外箱尺寸-长（厘米）") &&
    schema.fields.includes("外箱尺寸-宽（厘米）") &&
    schema.fields.includes("外箱尺寸-高（厘米）")
  ) {
    const l = toFiniteNumber(out["外箱尺寸-长（厘米）"] ?? "");
    const w = toFiniteNumber(out["外箱尺寸-宽（厘米）"] ?? "");
    const h = toFiniteNumber(out["外箱尺寸-高（厘米）"] ?? "");
    if (l != null && w != null && h != null) {
      out["外箱体积"] = formatDecimal(l * w * h, 4);
    }
  }

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

  // Auto-compute 派送费from last-mile pricing table
  if (
    pricingTable.length > 0 &&
    schema.fields.includes("派送费") &&
    schema.fields.includes("包裹计费重")
  ) {
    const billedKg = toFiniteNumber(out["包裹计费重"] ?? "");
    if (billedKg != null && billedKg > 0) {
      const feeUsd = lookupDispatchFeeUsd(pricingTable, billedKg);
      if (feeUsd != null) out["派送费"] = formatDecimal(feeUsd, 4);
    }
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

  for (const r of COPY_VALUE_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    out[r.target] = copyValue(out, r) ?? "";
  }

  for (const r of SUM_MULTIPLY_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.factor)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) ok = false;
    if (!ok) continue;
    out[r.target] = sumMultiplyValue(out, r) ?? "";
  }

  for (const r of SUM_MULTIPLY_CONST_RULES) {
    if (!schema.fields.includes(r.target)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) ok = false;
    if (!ok) continue;
    out[r.target] = sumMultiplyConstValue(out, r) ?? "";
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
  secondaryCreateButtonLabel,
  createButtonLabel = "新增数据",
}: {
  workspaceKey: string;
  title: string;
  groupLabel: string;
  hideCreateButton?: boolean;
  hideInquiryCreateButton?: boolean;
  secondaryCreateButtonLabel?: string;
  createButtonLabel?: string;
}) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [q, setQ] = useState("");
  const [lastMilePricing, setLastMilePricing] = useState<PricingEntry[]>([]);

  useEffect(() => {
    fetch("/api/config/last-mile-pricing")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        if (!json || typeof json !== "object") return;
        const rowsRaw = (json as Record<string, unknown>).rows;
        if (!Array.isArray(rowsRaw)) return;
        const entries: PricingEntry[] = [];
        for (const r of rowsRaw) {
          if (!r || typeof r !== "object") continue;
          const row = r as Record<string, unknown>;
          const wl = row.weight_lbs != null ? Number(row.weight_lbs) : null;
          const p = Number(row.price);
          if (!Number.isFinite(p)) continue;
          entries.push({ weight_lbs: wl != null && Number.isFinite(wl) ? wl : null, price: p });
        }
        setLastMilePricing(entries);
      })
      .catch(() => {});
  }, []);
  const canInquiryBulkAssign = useMemo(() => {
    const level = session?.user?.permissionLevel;
    if (level === "admin" || level === "super_admin") return true;
    const roleName = session?.user?.roleName;
    return roleName === "询价管理员" || roleName === "询价负责人";
  }, [session?.user?.permissionLevel, session?.user?.roleName]);
  const canEditInquiryRow = useCallback(
    (row: RecordRow) => {
      const level = session?.user?.permissionLevel;
      if (level === "admin" || level === "super_admin") return true;
      const obj = toRecordStringUnknown(row.data);
      const assignee = String(obj["询价人"] ?? "").trim();
      const currentUsername = session?.user?.username ?? "";
      return Boolean(assignee && currentUsername && assignee === currentUsername);
    },
    [session?.user?.permissionLevel, session?.user?.username],
  );
  const canEditPricingRow = useCallback(
    (row: RecordRow) => {
      const obj = toRecordStringUnknown(row.data);
      const operator = String(obj["运营人员"] ?? "").trim();
      return operator !== "";
    },
    [],
  );
  const canSeePricingBulkAssign = useMemo(() => {
    const level = session?.user?.permissionLevel;
    if (level === "admin" || level === "super_admin") return true;
    return session?.user?.roleName === "运营管理员";
  }, [session?.user?.permissionLevel, session?.user?.roleName]);

  const schema = useMemo(() => getWorkspaceSchema(workspaceKey), [workspaceKey]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  type SelectionStatusFilter =
    | ""
    | typeof SELECTION_PENDING_STATUS_VALUE
    | typeof INQUIRY_STATUS_VALUE
    | typeof SELECTION_ABANDON_STATUS_VALUE;
  const [selectionStatusFilter, setSelectionStatusFilter] = useState<SelectionStatusFilter>("");
  const [selectionHistoryMode, setSelectionHistoryMode] = useState(false);
  const [selectionHistoryRecords, setSelectionHistoryRecords] = useState<RecordRow[]>([]);
  const [selectionHistoryLoading, setSelectionHistoryLoading] = useState(false);
  type InquiryStatusFilter = "" | "待询价" | typeof INQUIRY_STATUS_VALUE | "待分配运营者";
  const [inquiryStatusFilter, setInquiryStatusFilter] = useState<InquiryStatusFilter>("");
  const [inquiryHistoryMode, setInquiryHistoryMode] = useState(false);
  const [inquiryHistoryRecords, setInquiryHistoryRecords] = useState<RecordRow[]>([]);
  const [inquiryHistoryLoading, setInquiryHistoryLoading] = useState(false);
  type PricingStatusFilter = "" | "待核价" | "待分配运营者" | "待确品" | "【核价】已放弃";
  const [pricingStatusFilter, setPricingStatusFilter] = useState<PricingStatusFilter>("");
  const [pricingHistoryMode, setPricingHistoryMode] = useState(false);
  const [pricingHistoryRecords, setPricingHistoryRecords] = useState<RecordRow[]>([]);
  const [pricingHistoryLoading, setPricingHistoryLoading] = useState(false);
  type ConfirmStatusFilter = "" | "待确品" | "待采购";
  const [confirmStatusFilter, setConfirmStatusFilter] = useState<ConfirmStatusFilter>("");
  const [confirmHistoryMode, setConfirmHistoryMode] = useState(false);
  const [confirmHistoryRecords, setConfirmHistoryRecords] = useState<RecordRow[]>([]);
  const [confirmHistoryLoading, setConfirmHistoryLoading] = useState(false);
  type PurchaseStatusFilter = "" | "待采购" | "待发货" | "已到仓" | "已发运";
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<PurchaseStatusFilter>("");
  const [purchaseHistoryMode, setPurchaseHistoryMode] = useState(false);
  const [purchaseHistoryRecords, setPurchaseHistoryRecords] = useState<RecordRow[]>([]);
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<
    "" | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "7d" | "30d" | "custom"
  >("");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [imageIndexByField, setImageIndexByField] = useState<Record<string, number>>({});
  const [linkDraftByField, setLinkDraftByField] = useState<Record<string, string[]>>({});
  const linkInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingLinkFocusKey = useRef<string | null>(null);
  const inquiryModalFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingInquiryModalFocus = useRef<{
    key: string;
    selectionStart: number | null;
    selectionEnd: number | null;
  } | null>(null);
  const editModalFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const editModalLastFocusedKey = useRef<string | null>(null);
  const pendingEditModalFocus = useRef<{
    key: string;
    selectionStart: number | null;
    selectionEnd: number | null;
  } | null>(null);
  const editModalComposingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ urls: string[]; index: number } | null>(null);

  useEffect(() => {
    if (workspaceKey !== "ops.selection") return;
    setSelectionStatusFilter("");
  }, [workspaceKey]);
  useEffect(() => {
    if (workspaceKey !== "ops.inquiry") return;
    setInquiryStatusFilter("");
  }, [workspaceKey]);
  useEffect(() => {
    if (workspaceKey !== "ops.pricing") return;
    setPricingStatusFilter("");
  }, [workspaceKey]);
  useEffect(() => {
    if (workspaceKey !== "ops.confirm") return;
    setConfirmStatusFilter("");
  }, [workspaceKey]);
  useEffect(() => {
    if (workspaceKey !== "ops.purchase") return;
    setPurchaseStatusFilter("");
  }, [workspaceKey]);

  const [editing, setEditing] = useState<{
    id: number | null;
    data: Record<string, string>;
    relatedIds?: number[];
    specIdMap?: Record<string, number[]>;
    specSlotIds?: number[];
  } | null>(null);
  const [editCreateMode, setEditCreateMode] = useState<"default" | "selectionData">("default");

  const [inquiryCreateOpen, setInquiryCreateOpen] = useState(false);
  const [inquiryUnits, setInquiryUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [inquiryForm, setInquiryForm] = useState<{
    productName: string;
    category: string;
    productImages: string;
    referenceLinks: string;
    productSpec: string;
    productUnitPrice: string;
    moq: string;
    discountPolicy: "" | "有" | "无";
    discountNote: string;
    deliveryCycle: string;
    packageLengthCm: string;
    packageWidthCm: string;
    packageHeightCm: string;
    packageWeightKg: string;
    mainProcess: string;
    factoryLocation: string;
    factoryContact: string;
    factoryPhone: string;
    purchaseCost: string;
    usdRate: string;
  }>({
    productName: "",
    category: "",
    productImages: "",
    referenceLinks: "",
    productSpec: "",
    productUnitPrice: "",
    moq: "",
    discountPolicy: "",
    discountNote: "",
    deliveryCycle: "",
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    packageWeightKg: "",
    mainProcess: "",
    factoryLocation: "",
    factoryContact: "",
    factoryPhone: "",
    purchaseCost: "",
    usdRate: "",
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
  const [inquiryWithdrawOpen, setInquiryWithdrawOpen] = useState(false);
  const [inquiryWithdrawRecordId, setInquiryWithdrawRecordId] = useState<number | null>(null);
  const [inquiryWithdrawPreview, setInquiryWithdrawPreview] = useState<{
    productName: string;
    category: string;
    productSize: string;
    productWeight: string;
  } | null>(null);
  const [inquiryWithdrawReason, setInquiryWithdrawReason] = useState("");
  const [inquiryWithdrawSaving, setInquiryWithdrawSaving] = useState(false);
  const [selectionAbandonOpen, setSelectionAbandonOpen] = useState(false);
  const [selectionAbandonRecordId, setSelectionAbandonRecordId] = useState<number | null>(null);
  const [selectionAbandonPreview, setSelectionAbandonPreview] = useState<{
    productName: string;
    category: string;
    productSize: string;
    productWeight: string;
  } | null>(null);
  const [selectionAbandonReason, setSelectionAbandonReason] = useState("");
  const [selectionAbandonSaving, setSelectionAbandonSaving] = useState(false);
  const [inquiryBulkAssignOpen, setInquiryBulkAssignOpen] = useState(false);
  const [inquiryBulkAssignPerson, setInquiryBulkAssignPerson] = useState("");
  const [inquiryBulkAssignSaving, setInquiryBulkAssignSaving] = useState(false);
  const [inquiryBulkEditOpen, setInquiryBulkEditOpen] = useState(false);
  const [inquiryBulkEditUnits, setInquiryBulkEditUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [inquiryBulkEditSaving, setInquiryBulkEditSaving] = useState(false);
  const [inquiryBulkEditAction, setInquiryBulkEditAction] = useState<null | "confirm" | "submit">(null);
  const [inquiryBulkEditPreview, setInquiryBulkEditPreview] = useState<{
    productName: string;
    category: string;
    productUnitPrice: string;
    moq: string;
    discountPolicy: string;
    discountNote: string;
    packageLengthCm: string;
    packageWidthCm: string;
    packageHeightCm: string;
    packageWeightKg: string;
    mainProcess: string;
    factoryLocation: string;
    factoryContact: string;
    factoryPhone: string;
  } | null>(null);
  const [inquiryBulkEditIds, setInquiryBulkEditIds] = useState<number[]>([]);
  const [inquiryBulkEditSpecs, setInquiryBulkEditSpecs] = useState<string[]>([]);
  const [inquiryBulkEditForm, setInquiryBulkEditForm] = useState<{
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
  const [inquirySelectedIds, setInquirySelectedIds] = useState<Set<number>>(() => new Set());
  const canInquiryBulkEdit = useMemo(() => {
    if (workspaceKey !== "ops.inquiry") return false;
    const ids = Array.from(inquirySelectedIds);
    if (ids.length === 0) return false;
    let first = "";
    for (const row of records) {
      if (!inquirySelectedIds.has(row.id)) continue;
      const obj = toRecordStringUnknown(row.data);
      const status = String(obj["状态"] ?? "").trim();
      if (status === INQUIRY_STATUS_VALUE) return false;
      const name = String(obj["名称"] ?? obj["商品名称"] ?? "").trim();
      if (!name) return false;
      if (!first) first = name;
      else if (name !== first) return false;
    }
    return Boolean(first);
  }, [inquirySelectedIds, records, workspaceKey]);
  const [pricingSelectedIds, setPricingSelectedIds] = useState<Set<number>>(() => new Set());
  const canPricingBulkAssign = useMemo(() => {
    if (workspaceKey !== "ops.pricing") return false;
    if (pricingSelectedIds.size === 0) return false;
    for (const row of records) {
      if (!pricingSelectedIds.has(row.id)) continue;
      const obj = toRecordStringUnknown(row.data);
      const status = String(obj["状态"] ?? "").trim();
      if (status !== "待分配运营者") return false;
    }
    return true;
  }, [pricingSelectedIds, records, workspaceKey]);
  const [pricingAssigneeOptions, setPricingAssigneeOptions] = useState<{ username: string; displayName: string }[]>([]);
  const [pricingAssigneeLoading, setPricingAssigneeLoading] = useState(false);
  const [pricingBulkAssignOpen, setPricingBulkAssignOpen] = useState(false);
  const [pricingBulkAssignPerson, setPricingBulkAssignPerson] = useState("");
  const [pricingBulkAssignSaving, setPricingBulkAssignSaving] = useState(false);
  const [pricingRowAction, setPricingRowAction] = useState<string | null>(null);
  const [pricingAbandonOpen, setPricingAbandonOpen] = useState(false);
  const [pricingAbandonRecordId, setPricingAbandonRecordId] = useState<number | null>(null);
  const [pricingAbandonProductName, setPricingAbandonProductName] = useState("");
  const [pricingAbandonReason, setPricingAbandonReason] = useState("");
  const [pricingAbandonSaving, setPricingAbandonSaving] = useState(false);
  const [pricingWithdrawOpen, setPricingWithdrawOpen] = useState(false);
  const [pricingWithdrawRecordId, setPricingWithdrawRecordId] = useState<number | null>(null);
  const [pricingWithdrawProductName, setPricingWithdrawProductName] = useState("");
  const [pricingWithdrawReason, setPricingWithdrawReason] = useState("");
  const [pricingWithdrawSaving, setPricingWithdrawSaving] = useState(false);
  const [pricingUnits, setPricingUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [confirmUnits, setConfirmUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [purchaseUnits, setPurchaseUnits] = useState<"cmkg" | "inlb">("cmkg");
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
  const [confirmWithdrawRecordId, setConfirmWithdrawRecordId] = useState<number | null>(null);
  const [confirmWithdrawProductName, setConfirmWithdrawProductName] = useState("");
  const [confirmWithdrawReason, setConfirmWithdrawReason] = useState("");
  const [confirmWithdrawSaving, setConfirmWithdrawSaving] = useState(false);
  const [purchaseWithdrawOpen, setPurchaseWithdrawOpen] = useState(false);
  const [purchaseWithdrawRecordId, setPurchaseWithdrawRecordId] = useState<number | null>(null);
  const [purchaseWithdrawProductName, setPurchaseWithdrawProductName] = useState("");
  const [purchaseWithdrawReason, setPurchaseWithdrawReason] = useState("");
  const [purchaseWithdrawSaving, setPurchaseWithdrawSaving] = useState(false);
  const [purchaseRowAction, setPurchaseRowAction] = useState<string | null>(null);
  const [confirmRowAction, setConfirmRowAction] = useState<string | null>(null);

  const operatorName = useMemo(() => {
    const name = session?.user?.name;
    const username = session?.user?.username;
    return typeof name === "string" && name.trim() ? name.trim() : typeof username === "string" ? username : "";
  }, [session?.user?.name, session?.user?.username]);

  useEffect(() => {
    setFilters({});
    setTimeRange("");
    setCustomStartDate("");
    setCustomEndDate("");
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryUnits("cmkg");
    setInquiryForm({
      productName: "",
      category: "",
      productImages: "",
      referenceLinks: "",
      productSpec: "",
      productUnitPrice: "",
      moq: "",
      discountPolicy: "",
      discountNote: "",
      deliveryCycle: "",
      packageLengthCm: "",
      packageWidthCm: "",
      packageHeightCm: "",
      packageWeightKg: "",
      mainProcess: "",
      factoryLocation: "",
      factoryContact: "",
      factoryPhone: "",
      purchaseCost: "",
      usdRate: "",
    });
    setInquiryActionLoading(null);
    setInquiryEditingId(null);
    setInquiryEditingStatus("");
    setInquiryAssignOpen(false);
    setInquiryAssignUnits("cmkg");
    setInquiryAssignRecordId(null);
    setInquiryWithdrawOpen(false);
    setInquiryWithdrawRecordId(null);
    setInquiryWithdrawPreview(null);
    setInquiryWithdrawReason("");
    setInquiryWithdrawSaving(false);
    setSelectionAbandonOpen(false);
    setSelectionAbandonRecordId(null);
    setSelectionAbandonPreview(null);
    setSelectionAbandonReason("");
    setSelectionAbandonSaving(false);
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
    setInquiryBulkAssignOpen(false);
    setInquiryBulkAssignPerson("");
    setInquiryBulkAssignSaving(false);
    setInquiryBulkEditOpen(false);
    setInquiryBulkEditUnits("cmkg");
    setInquiryBulkEditSaving(false);
    setInquiryBulkEditAction(null);
    setInquiryBulkEditPreview(null);
    setInquiryBulkEditIds([]);
    setInquiryBulkEditSpecs([]);
    setInquiryBulkEditForm({
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
    setInquirySelectedIds(new Set());
    setPricingSelectedIds(new Set());
    setPricingAssigneeOptions([]);
    setPricingAssigneeLoading(false);
    setPricingBulkAssignOpen(false);
    setPricingBulkAssignPerson("");
    setPricingBulkAssignSaving(false);
    setPricingRowAction(null);
    setPricingUnits("cmkg");
    setConfirmUnits("cmkg");
    setPurchaseUnits("cmkg");
    setUploadingField(null);
    setImageIndexByField({});
    setLinkDraftByField({});
  }, [workspaceKey]);

  useEffect(() => {
    if (editing) return;
    setLinkDraftByField({});
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    if (editing.id != null) setEditCreateMode("default");
  }, [editing]);

  useLayoutEffect(() => {
    if (isComposing) return;
    const key = pendingLinkFocusKey.current;
    if (!key) return;
    pendingLinkFocusKey.current = null;
    const el = linkInputRefs.current[key];
    if (!el) return;
    if (document.activeElement === el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {}
  }, [linkDraftByField, isComposing]);

  useLayoutEffect(() => {
    if (isComposing) return;
    if (!inquiryCreateOpen && !inquiryBulkEditOpen) return;
    const pending = pendingInquiryModalFocus.current;
    if (!pending) return;
    pendingInquiryModalFocus.current = null;
    const el = inquiryModalFieldRefs.current[pending.key];
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = pending.selectionStart;
      const end = pending.selectionEnd;
      if (start != null && end != null) {
        try {
          el.setSelectionRange(start, end);
        } catch {}
      }
    }
  }, [inquiryCreateOpen, inquiryForm, inquiryUnits, inquiryBulkEditOpen, inquiryBulkEditForm, inquiryBulkEditUnits, isComposing]);

  useLayoutEffect(() => {
    if (!editing) return;
    if (isComposing || editModalComposingRef.current) return;
    const pending = pendingEditModalFocus.current;
    if (!pending) return;
    pendingEditModalFocus.current = null;
    const el = editModalFieldRefs.current[pending.key];
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = pending.selectionStart;
      const end = pending.selectionEnd;
      if (start != null && end != null) {
        try {
          el.setSelectionRange(start, end);
        } catch {}
      }
    }
  }, [editing, isComposing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const key = editModalLastFocusedKey.current;
    if (!key) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const el = editModalFieldRefs.current[key];
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (isComposing || editModalComposingRef.current) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {}
    }
  }, [editing, isComposing]);

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
    if (workspaceKey === "ops.purchase" || workspaceKey === "ops.selection" || workspaceKey === "ops.confirm") {
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
    if (workspaceKey === "ops.purchase" || workspaceKey === "ops.selection" || workspaceKey === "ops.confirm") {
      return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f) && !PURCHASE_TABLE_HIDDEN_FIELDS.has(f));
    }
    if (workspaceKey === "ops.inquiry") {
      return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f) && !INQUIRY_TABLE_HIDDEN_FIELDS.has(f));
    }
    return visibleFields.filter((f) => !WORKSPACE_TABLE_HIDDEN_FIELDS.has(f));
  }, [schema, visibleFields, workspaceKey]);

  const inquiryComputedPreview = useMemo(() => {
    if (!schema || workspaceKey !== "ops.inquiry") return [] as Array<{ field: string; value: string }>;

    // Keep existing row data as seed when editing, then override with current form values.
    // This preserves non-form fields (e.g. cost inputs) for computed preview.
    const seedData: Record<string, string> = {};
    if (inquiryEditingId != null) {
      const editingRow = records.find((r) => r.id === inquiryEditingId);
      if (editingRow) {
        const obj = toRecordStringUnknown(editingRow.data);
        for (const [k, v] of Object.entries(obj)) seedData[k] = String(v ?? "");
      }
    }

    const data: Record<string, unknown> = {
      ...seedData,
      名称: inquiryForm.productName,
      产品图片: inquiryForm.productImages,
      参考链接: inquiryForm.referenceLinks,
      "单套尺寸-长（厘米）": inquiryForm.packageLengthCm,
      "单套尺寸-宽（厘米）": inquiryForm.packageWidthCm,
      "单套尺寸-高（厘米）": inquiryForm.packageHeightCm,
      "包裹实重（公斤）": inquiryForm.packageWeightKg,
      主要工艺: inquiryForm.mainProcess,
      工厂所在地: inquiryForm.factoryLocation,
      工厂联系人: inquiryForm.factoryContact,
      联系人电话: inquiryForm.factoryPhone,
      状态: inquiryEditingStatus.trim() || "待询价",
    };
    if (inquiryForm.category.trim()) data["所属类目"] = inquiryForm.category.trim();
    if (inquiryForm.productUnitPrice.trim()) data["产品单价"] = inquiryForm.productUnitPrice.trim();
    if (inquiryForm.moq.trim()) data["起订量"] = inquiryForm.moq.trim();
    if (inquiryForm.discountPolicy.trim()) data["优惠政策"] = inquiryForm.discountPolicy.trim();
    if (inquiryForm.discountPolicy === "有" && inquiryForm.discountNote.trim()) data["优惠政策备注"] = inquiryForm.discountNote.trim();
    if (inquiryForm.deliveryCycle.trim()) data["交货周期"] = inquiryForm.deliveryCycle.trim();
    if (inquiryForm.purchaseCost.trim()) data["采购成本"] = inquiryForm.purchaseCost.trim();
    if (inquiryForm.usdRate.trim()) data["美元汇率"] = inquiryForm.usdRate.trim();
    if (operatorName) data["运营人员"] = operatorName;

    const stringData: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) stringData[k] = String(v ?? "");
    const computedData = applyComputedFields(schema, stringData, lastMilePricing);

    const previewFields = [
      "体积重系数",
      "包裹体积（立方厘米）",
      "体积重",
      "包裹计费重",
      "包裹计费重（磅）",
      "单套尺寸-长（英寸）",
      "单套尺寸-宽（英寸）",
      "单套尺寸-高（英寸）",
      "派送费",
      "尾程成本（人民币）",
      "采购成本",
      "成本总计",
      "负向成本",
      "人民币报价",
      "temu核价最低标准（未加2.99）",
      "temu报价",
      "temu售价",
    ];

    const out: Array<{ field: string; value: string }> = [];
    for (const field of previewFields) {
      if (!schema.fields.includes(field)) continue;
      const rawValue = String(computedData[field] ?? "").trim();
      const value = formatInquiryPreviewValue(field, rawValue);
      out.push({ field, value });
    }
    return out;
  }, [
    inquiryEditingStatus,
    inquiryEditingId,
    inquiryForm.category,
    inquiryForm.deliveryCycle,
    inquiryForm.discountNote,
    inquiryForm.discountPolicy,
    inquiryForm.factoryContact,
    inquiryForm.factoryLocation,
    inquiryForm.factoryPhone,
    inquiryForm.mainProcess,
    inquiryForm.moq,
    inquiryForm.packageHeightCm,
    inquiryForm.packageLengthCm,
    inquiryForm.packageWeightKg,
    inquiryForm.packageWidthCm,
    inquiryForm.productImages,
    inquiryForm.productName,
    inquiryForm.productUnitPrice,
    inquiryForm.purchaseCost,
    inquiryForm.usdRate,
    inquiryForm.referenceLinks,
    operatorName,
    records,
    schema,
    workspaceKey,
  ]);

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
    if (
      workspaceKey === "ops.purchase" ||
      workspaceKey === "ops.selection" ||
      workspaceKey === "ops.inquiry" ||
      workspaceKey === "ops.pricing" ||
      workspaceKey === "ops.confirm"
    ) {
      if (timeRange) qs.set("timeRange", timeRange);
      if (timeRange === "custom") {
        if (customStartDate) qs.set("startDate", customStartDate);
        if (customEndDate) qs.set("endDate", customEndDate);
      }
    }
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  }, [customEndDate, customStartDate, filters, q, schema, timeRange, visibleFields, workspaceKey]);

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
        if (
          workspaceKey === "ops.purchase" ||
          workspaceKey === "ops.selection" ||
          workspaceKey === "ops.inquiry" ||
          workspaceKey === "ops.pricing" ||
          workspaceKey === "ops.confirm"
        ) {
          if (timeRange) qs.set("timeRange", timeRange);
          if (timeRange === "custom") {
            if (customStartDate) qs.set("startDate", customStartDate);
            if (customEndDate) qs.set("endDate", customEndDate);
          }
        }
        const s = qs.toString();
        url = s ? `${base}?${s}` : base;
      }
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setRecords(json.records ?? []);
    } finally {
      setLoading(false);
    }
  }, [customEndDate, customStartDate, filters, q, schema, timeRange, visibleFields, workspaceKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (workspaceKey !== "ops.inquiry") return;
    setInquirySelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const current = new Set<number>();
      for (const r of records) current.add(r.id);
      const next = new Set<number>();
      for (const id of prev) if (current.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [records, workspaceKey]);

  useEffect(() => {
    if (workspaceKey !== "ops.pricing") return;
    setPricingSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const current = new Set<number>();
      for (const r of records) current.add(r.id);
      const next = new Set<number>();
      for (const id of prev) if (current.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [records, workspaceKey]);

  function openCreateWithMode(mode: "default" | "selectionData") {
    if (!schema) return;
    setEditCreateMode(mode);
    const data: Record<string, string> = {};
    for (const f of schema.fields) data[f] = getDefaultFieldValue(f);
    if (schema.fields.includes("运营人员") && operatorName) data["运营人员"] = operatorName;
    if (workspaceKey === "ops.selection" && schema.fields.includes("状态")) data["状态"] = "待选品";
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
    setEditing({ id: null, data: applyComputedFields(schema, data, lastMilePricing) });
  }

  function openCreate() {
    openCreateWithMode("default");
  }

  function openSecondaryCreate() {
    openCreateWithMode("selectionData");
  }

  function openInquiryCreate() {
    setEditing(null);
    setInquiryUnits("cmkg");
    setInquiryEditingId(null);
    setInquiryEditingStatus("");
    setInquiryForm({
      productName: (filters["名称"] ?? "").trim(),
      category: "",
      productImages: "",
      referenceLinks: "",
      productSpec: "",
      productUnitPrice: "",
      moq: "",
      discountPolicy: "",
      discountNote: "",
      deliveryCycle: "",
      packageLengthCm: "",
      packageWidthCm: "",
      packageHeightCm: "",
      packageWeightKg: "",
      mainProcess: "",
      factoryLocation: "",
      factoryContact: "",
      factoryPhone: "",
      purchaseCost: "",
      usdRate: "",
    });
    setInquiryActionLoading(null);
    setInquiryCreateOpen(true);
  }

  async function saveInquiryPurchase(
    status: "待询价" | "待分配运营者" | "待核价" | "待确品" | "已确品",
    action: "save" | "submit",
  ) {
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
        产品图片: inquiryForm.productImages,
        参考链接: inquiryForm.referenceLinks,
        产品规格: inquiryForm.productSpec,
        "单套尺寸-长（厘米）": inquiryForm.packageLengthCm,
        "单套尺寸-宽（厘米）": inquiryForm.packageWidthCm,
        "单套尺寸-高（厘米）": inquiryForm.packageHeightCm,
        "包裹实重（公斤）": inquiryForm.packageWeightKg,
        主要工艺: inquiryForm.mainProcess,
        工厂所在地: inquiryForm.factoryLocation,
        工厂联系人: inquiryForm.factoryContact,
        联系人电话: inquiryForm.factoryPhone,
        状态: resolvedStatus,
      };
      if (!String(inquiryForm.productImages ?? "").trim()) delete data["产品图片"];
      if (!String(inquiryForm.referenceLinks ?? "").trim()) delete data["参考链接"];
      if (!String(inquiryForm.productSpec ?? "").trim()) delete data["产品规格"];
      if (category) data["所属类目"] = category;
      if (unitPrice) data["产品单价"] = unitPrice;
      if (moq) data["起订量"] = moq;
      if (discountPolicy) data["优惠政策"] = discountPolicy;
      if (discountPolicy === "有" && discountNote) data["优惠政策备注"] = discountNote;
      if (inquiryForm.deliveryCycle.trim()) data["交货周期"] = inquiryForm.deliveryCycle.trim();
      if (inquiryForm.purchaseCost.trim()) data["采购成本"] = inquiryForm.purchaseCost.trim();
      if (inquiryForm.usdRate.trim()) data["美元汇率"] = inquiryForm.usdRate.trim();
      if (operatorName) data["运营人员"] = operatorName;

      const stringData: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) stringData[k] = String(v ?? "");
      const computedData = schema ? applyComputedFields(schema, stringData, lastMilePricing) : stringData;

      const endpointBase = `/api/workspace/${encodeURIComponent(workspaceKey)}/records`;
      const url = inquiryEditingId != null ? `${endpointBase}/${inquiryEditingId}` : endpointBase;
      const res = await fetch(url, {
        method: inquiryEditingId != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: computedData }),
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

  function openInquiryBulkAssign() {
    if (workspaceKey !== "ops.inquiry") return;
    if (inquirySelectedIds.size === 0) return;
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignOpen(false);
    setInquiryAssignRecordId(null);
    setInquiryAssignPerson("");
    setInquiryBulkEditOpen(false);
    setInquiryBulkEditIds([]);
    setInquiryBulkEditSpecs([]);
    setInquiryBulkAssignSaving(false);
    setInquiryBulkAssignOpen(true);
    void ensureInquiryAssigneesLoaded();
  }

  function openInquiryWithdraw(row: RecordRow) {
    if (workspaceKey !== "ops.inquiry") return;
    const obj = toRecordStringUnknown(row.data);
    const status = String(obj["状态"] ?? "").trim();
    if (status !== "待询价") return;
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignOpen(false);
    setInquiryAssignRecordId(null);
    setInquiryAssignPerson("");
    setInquiryBulkAssignOpen(false);
    setInquiryBulkAssignPerson("");
    setInquiryBulkEditOpen(false);
    setInquiryWithdrawRecordId(row.id);
    const productName = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    const category = String(obj["所属类目"] ?? "").trim() || "—";
    const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
    const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
    const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
    const productSize = pL || pW || pH ? `${pL || "—"}x${pW || "—"}x${pH || "—"}cm` : "—x—x—cm";
    const w = String(obj["产品重量"] ?? "").trim();
    const productWeight = w ? `${w}kg` : "—kg";
    setInquiryWithdrawPreview({ productName, category, productSize, productWeight });
    setInquiryWithdrawReason("");
    setInquiryWithdrawSaving(false);
    setInquiryWithdrawOpen(true);
  }

  async function saveInquiryWithdraw() {
    if (workspaceKey !== "ops.inquiry") return;
    if (inquiryWithdrawSaving) return;
    if (!inquiryWithdrawRecordId) return;
    const reason = inquiryWithdrawReason.trim();
    if (!reason) {
      alert("请填写撤回理由");
      return;
    }

    const row = records.find((r) => r.id === inquiryWithdrawRecordId);
    const baseData = row ? toRecordStringUnknown(row.data) : {};
    const nextData: Record<string, unknown> = { ...baseData, 状态: "待选品", 撤回理由: reason };

    setInquiryWithdrawSaving(true);
    try {
      const res = await fetch(
        `/api/workspace/${encodeURIComponent(workspaceKey)}/records/${inquiryWithdrawRecordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: nextData }),
        },
      );
      if (!res.ok) {
        alert("撤回失败");
        return;
      }
      setInquiryWithdrawOpen(false);
      setInquiryWithdrawRecordId(null);
      setInquiryWithdrawPreview(null);
      setInquiryWithdrawReason("");
      await load();
    } finally {
      setInquiryWithdrawSaving(false);
    }
  }

  function openSelectionAbandon(row: RecordRow) {
    if (workspaceKey !== "ops.selection") return;
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignOpen(false);
    setInquiryAssignRecordId(null);
    setInquiryAssignPerson("");
    setInquiryBulkAssignOpen(false);
    setInquiryBulkAssignPerson("");
    setInquiryBulkEditOpen(false);
    setSelectionAbandonRecordId(row.id);
    const obj = toRecordStringUnknown(row.data);
    const productName = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    const category = String(obj["所属类目"] ?? "").trim() || "—";
    const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
    const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
    const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
    const productSize = pL || pW || pH ? `${pL || "—"}x${pW || "—"}x${pH || "—"}cm` : "—x—x—cm";
    const w = String(obj["产品重量"] ?? "").trim();
    const productWeight = w ? `${w}kg` : "—kg";
    setSelectionAbandonPreview({ productName, category, productSize, productWeight });
    setSelectionAbandonReason("");
    setSelectionAbandonSaving(false);
    setSelectionAbandonOpen(true);
  }

  async function saveSelectionAbandon() {
    if (workspaceKey !== "ops.selection") return;
    if (selectionAbandonSaving) return;
    if (!selectionAbandonRecordId) return;
    const reason = selectionAbandonReason.trim();
    if (!reason) {
      alert("请填写放弃理由");
      return;
    }

    const row = records.find((r) => r.id === selectionAbandonRecordId);
    const baseData = row ? toRecordStringUnknown(row.data) : {};
    const nextData: Record<string, unknown> = { ...baseData, 状态: SELECTION_ABANDON_STATUS_VALUE, 放弃理由: reason };

    setSelectionAbandonSaving(true);
    try {
      const res = await fetch(
        `/api/workspace/${encodeURIComponent(workspaceKey)}/records/${selectionAbandonRecordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: nextData }),
        },
      );
      if (!res.ok) {
        alert("放弃失败");
        return;
      }
      setSelectionAbandonOpen(false);
      setSelectionAbandonRecordId(null);
      setSelectionAbandonPreview(null);
      setSelectionAbandonReason("");
      await load();
    } finally {
      setSelectionAbandonSaving(false);
    }
  }

  async function ensurePricingAssigneesLoaded() {
    if (pricingAssigneeLoading) return;
    if (pricingAssigneeOptions.length > 0) return;
    const currentUsername = typeof session?.user?.username === "string" ? session.user.username : "";
    const currentRoleName = typeof session?.user?.roleName === "string" ? session.user.roleName : "";
    setPricingAssigneeLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        const fallback = currentUsername ? [{ username: currentUsername, displayName: currentUsername }] : [];
        setPricingAssigneeOptions(fallback);
        alert(typeof err === "string" && err.trim() ? err : "加载运营者失败");
        return;
      }
      const raw = json && typeof json === "object" && "users" in json ? (json as { users?: unknown }).users : null;
      if (!Array.isArray(raw)) {
        const fallback = currentUsername ? [{ username: currentUsername, displayName: currentUsername }] : [];
        setPricingAssigneeOptions(fallback);
        return;
      }
      const list: { username: string; displayName: string }[] = [];
      for (const it of raw) {
        const u = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
        const username = u && typeof u.username === "string" ? u.username : "";
        const displayName = u && typeof u.display_name === "string" ? u.display_name : "";
        const roleName = u && typeof u.role_name === "string" ? u.role_name : "";
        const isDisabled = u && typeof u.is_disabled === "number" ? u.is_disabled : 0;
        if (!username) continue;
        if (isDisabled) continue;
        if (!roleName.includes("运营")) continue;
        list.push({ username, displayName: displayName || username });
      }
      // Always ensure current user can assign to themselves
      if (currentUsername && !list.some((u) => u.username === currentUsername)) {
        list.unshift({ username: currentUsername, displayName: currentUsername });
      }
      if (list.length === 0 && currentUsername && currentRoleName.includes("运营")) {
        list.push({ username: currentUsername, displayName: currentUsername });
      }
      setPricingAssigneeOptions(list);
    } finally {
      setPricingAssigneeLoading(false);
    }
  }

  function openPricingBulkAssign(mode: "bulk" | "single" = "bulk") {
    if (workspaceKey !== "ops.pricing") return;
    if (pricingSelectedIds.size === 0) return;
    if (mode === "bulk" && !canPricingBulkAssign) return;
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignOpen(false);
    setInquiryAssignRecordId(null);
    setInquiryAssignPerson("");
    setInquiryWithdrawOpen(false);
    setInquiryWithdrawRecordId(null);
    setInquiryWithdrawPreview(null);
    setInquiryWithdrawReason("");
    setInquiryBulkAssignOpen(false);
    setInquiryBulkAssignPerson("");
    setInquiryBulkEditOpen(false);
    setInquiryBulkEditIds([]);
    setInquiryBulkEditSpecs([]);
    setPricingBulkAssignSaving(false);
    setPricingBulkAssignPerson("");
    setPricingBulkAssignOpen(true);
    void ensurePricingAssigneesLoaded();
  }

  function openPricingAssign(row: RecordRow) {
    if (workspaceKey !== "ops.pricing") return;
    setPricingSelectedIds(new Set([row.id]));
    openPricingBulkAssign("single");
  }

  async function savePricingBulkAssign() {
    if (pricingBulkAssignSaving) return;
    if (workspaceKey !== "ops.pricing") return;
    const ids = Array.from(pricingSelectedIds);
    if (ids.length === 0) return;
    const assignee = pricingBulkAssignPerson.trim();
    if (!assignee) {
      alert("请选择运营者");
      return;
    }

    setPricingBulkAssignSaving(true);
    try {
      for (const id of ids) {
        const row = records.find((r) => r.id === id);
        const baseData = row ? toRecordStringUnknown(row.data) : {};
        const nextData: Record<string, unknown> = { ...baseData, 运营人员: assignee, 状态: "待核价" };

        const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: nextData }),
        });
        const json: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err =
            json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
          alert(typeof err === "string" && err.trim() ? err : `分配失败（ID: ${id}）`);
          return;
        }
      }
      setPricingBulkAssignOpen(false);
      setPricingBulkAssignPerson("");
      setPricingSelectedIds(new Set());
      await load();
    } finally {
      setPricingBulkAssignSaving(false);
    }
  }

  async function updatePricingRowStatus(recordId: number, nextStatus: string) {
    if (workspaceKey !== "ops.pricing") return;
    const actionKey = `${recordId}:${nextStatus}`;
    if (pricingRowAction) return;
    setPricingRowAction(actionKey);
    try {
      const row = records.find((r) => r.id === recordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: nextStatus };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "更新失败");
        return;
      }
      await load();
    } finally {
      setPricingRowAction(null);
    }
  }

  function openPricingAbandon(row: RecordRow) {
    if (workspaceKey !== "ops.pricing") return;
    const obj = toRecordStringUnknown(row.data);
    const status = String(obj["状态"] ?? "").trim();
    if (status === "已放弃" || status === "【核价】已放弃") return;
    const name = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    setPricingAbandonRecordId(row.id);
    setPricingAbandonProductName(name);
    setPricingAbandonReason("");
    setPricingAbandonSaving(false);
    setPricingAbandonOpen(true);
  }

  async function savePricingAbandon() {
    if (pricingAbandonSaving) return;
    if (workspaceKey !== "ops.pricing") return;
    if (pricingAbandonRecordId == null) return;
    const reason = pricingAbandonReason.trim();
    if (!reason) {
      alert("请填写放弃理由");
      return;
    }
    setPricingAbandonSaving(true);
    try {
      const row = records.find((r) => r.id === pricingAbandonRecordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: "【核价】已放弃", 放弃理由: reason };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${pricingAbandonRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "放弃失败");
        return;
      }
      setPricingAbandonOpen(false);
      setPricingAbandonRecordId(null);
      setPricingAbandonProductName("");
      setPricingAbandonReason("");
      await load();
    } finally {
      setPricingAbandonSaving(false);
    }
  }

  function openPricingWithdraw(row: RecordRow) {
    if (workspaceKey !== "ops.pricing") return;
    const obj = toRecordStringUnknown(row.data);
    const status = String(obj["状态"] ?? "").trim();
    if (status === "待询价") return;
    const name = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    setPricingWithdrawRecordId(row.id);
    setPricingWithdrawProductName(name);
    setPricingWithdrawReason("");
    setPricingWithdrawSaving(false);
    setPricingWithdrawOpen(true);
  }

  async function savePricingWithdraw() {
    if (pricingWithdrawSaving) return;
    if (workspaceKey !== "ops.pricing") return;
    if (pricingWithdrawRecordId == null) return;
    const reason = pricingWithdrawReason.trim();
    if (!reason) {
      alert("请填写撤回理由");
      return;
    }
    setPricingWithdrawSaving(true);
    try {
      const row = records.find((r) => r.id === pricingWithdrawRecordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: "待询价", 撤回理由: reason, 放弃理由: "" };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${pricingWithdrawRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "撤回失败");
        return;
      }
      setPricingWithdrawOpen(false);
      setPricingWithdrawRecordId(null);
      setPricingWithdrawProductName("");
      setPricingWithdrawReason("");
      await load();
    } finally {
      setPricingWithdrawSaving(false);
    }
  }

  async function updatePurchaseRowStatus(recordId: number, nextStatus: string) {
    if (workspaceKey !== "ops.purchase") return;
    const actionKey = `${recordId}:${nextStatus}`;
    if (purchaseRowAction) return;
    setPurchaseRowAction(actionKey);
    try {
      const row = records.find((r) => r.id === recordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: nextStatus };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "更新失败");
        return;
      }
      await load();
    } finally {
      setPurchaseRowAction(null);
    }
  }

  function openPurchaseWithdraw(row: RecordRow) {
    if (workspaceKey !== "ops.purchase") return;
    const obj = toRecordStringUnknown(row.data);
    const name = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    setPurchaseWithdrawRecordId(row.id);
    setPurchaseWithdrawProductName(name);
    setPurchaseWithdrawReason("");
    setPurchaseWithdrawSaving(false);
    setPurchaseWithdrawOpen(true);
  }

  async function savePurchaseWithdraw() {
    if (purchaseWithdrawSaving) return;
    if (workspaceKey !== "ops.purchase") return;
    if (purchaseWithdrawRecordId == null) return;
    const reason = purchaseWithdrawReason.trim();
    if (!reason) {
      alert("请填写撤回理由");
      return;
    }
    setPurchaseWithdrawSaving(true);
    try {
      const row = records.find((r) => r.id === purchaseWithdrawRecordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: "待确品", 撤回理由: reason };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${purchaseWithdrawRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "撤回失败");
        return;
      }
      setPurchaseWithdrawOpen(false);
      setPurchaseWithdrawRecordId(null);
      setPurchaseWithdrawProductName("");
      setPurchaseWithdrawReason("");
      await load();
    } finally {
      setPurchaseWithdrawSaving(false);
    }
  }

  async function updateConfirmRowStatus(recordId: number, nextStatus: string) {
    if (workspaceKey !== "ops.confirm") return;
    const actionKey = `${recordId}:${nextStatus}`;
    if (confirmRowAction) return;
    setConfirmRowAction(actionKey);
    try {
      const row = records.find((r) => r.id === recordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: nextStatus };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "更新失败");
        return;
      }
      await load();
    } finally {
      setConfirmRowAction(null);
    }
  }

  function openConfirmWithdraw(row: RecordRow) {
    if (workspaceKey !== "ops.confirm") return;
    const obj = toRecordStringUnknown(row.data);
    const name = String(obj["名称"] ?? obj["商品名称"] ?? "").trim() || "—";
    setConfirmWithdrawRecordId(row.id);
    setConfirmWithdrawProductName(name);
    setConfirmWithdrawReason("");
    setConfirmWithdrawSaving(false);
    setConfirmWithdrawOpen(true);
  }

  async function saveConfirmWithdraw() {
    if (confirmWithdrawSaving) return;
    if (workspaceKey !== "ops.confirm") return;
    if (confirmWithdrawRecordId == null) return;
    const reason = confirmWithdrawReason.trim();
    if (!reason) {
      alert("请填写撤回理由");
      return;
    }
    setConfirmWithdrawSaving(true);
    try {
      const row = records.find((r) => r.id === confirmWithdrawRecordId);
      const baseData = row ? toRecordStringUnknown(row.data) : {};
      const nextData: Record<string, unknown> = { ...baseData, 状态: "待核价", 撤回理由: reason };
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${confirmWithdrawRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "撤回失败");
        return;
      }
      setConfirmWithdrawOpen(false);
      setConfirmWithdrawRecordId(null);
      setConfirmWithdrawProductName("");
      setConfirmWithdrawReason("");
      await load();
    } finally {
      setConfirmWithdrawSaving(false);
    }
  }

  function openInquiryBulkEdit() {
    if (workspaceKey !== "ops.inquiry") return;
    if (!canInquiryBulkEdit) {
      if (inquirySelectedIds.size > 0 && inquirySelectedIds.size !== 1) {
        alert(`批量修改仅支持：选中 1 条；或选中多条且商品名称一致；且状态不为 ${INQUIRY_STATUS_VALUE}`);
      }
      return;
    }
    const ids = Array.from(inquirySelectedIds);
    const selected = records.filter((r) => inquirySelectedIds.has(r.id));
    const commonValue = (getter: (obj: Record<string, unknown>) => string) => {
      if (selected.length === 0) return "";
      let first = "";
      for (const r of selected) {
        const obj = toRecordStringUnknown(r.data) as Record<string, unknown>;
        const v = getter(obj).trim();
        if (!first) first = v;
        else if (v !== first) return "（多条不一致）";
      }
      return first;
    };
    setEditing(null);
    setInquiryCreateOpen(false);
    setInquiryAssignOpen(false);
    setInquiryAssignRecordId(null);
    setInquiryAssignPerson("");
    setInquiryBulkAssignOpen(false);
    setInquiryBulkAssignPerson("");
    setInquiryBulkEditSaving(false);
    setInquiryBulkEditAction(null);
    setInquiryBulkEditUnits("cmkg");
    setInquiryBulkEditForm({
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
    setInquiryBulkEditIds(ids);
    setInquiryBulkEditSpecs(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const r of selected) {
        const obj = toRecordStringUnknown(r.data);
        const raw = String(obj["产品规格"] ?? "");
        const parts = parseDelimitedValues(raw);
        for (const p of parts) {
          const t = p.trim();
          if (!t) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    });
    setInquiryBulkEditPreview({
      productName: commonValue((o) => String(o["名称"] ?? o["商品名称"] ?? "")),
      category: commonValue((o) => String(o["所属类目"] ?? "")),
      productUnitPrice: commonValue((o) => String(o["产品单价"] ?? "")),
      moq: commonValue((o) => String(o["起订量"] ?? "")),
      discountPolicy: commonValue((o) => String(o["优惠政策"] ?? "")),
      discountNote: commonValue((o) => String(o["优惠政策备注"] ?? "")),
      packageLengthCm: commonValue((o) => String(o["单套尺寸-长（厘米）"] ?? "")),
      packageWidthCm: commonValue((o) => String(o["单套尺寸-宽（厘米）"] ?? "")),
      packageHeightCm: commonValue((o) => String(o["单套尺寸-高（厘米）"] ?? "")),
      packageWeightKg: commonValue((o) => String(o["包裹实重（公斤）"] ?? "")),
      mainProcess: commonValue((o) => String(o["主要工艺"] ?? "")),
      factoryLocation: commonValue((o) => String(o["工厂所在地"] ?? "")),
      factoryContact: commonValue((o) => String(o["工厂联系人"] ?? "")),
      factoryPhone: commonValue((o) => String(o["联系人电话"] ?? "")),
    });
    setInquiryBulkEditOpen(true);
  }

  async function saveInquiryBulkAssign() {
    if (inquiryBulkAssignSaving) return;
    if (workspaceKey !== "ops.inquiry") return;
    const ids = Array.from(inquirySelectedIds);
    if (ids.length === 0) return;
    const assignee = inquiryBulkAssignPerson.trim();
    if (!assignee) {
      alert("请选择询价人");
      return;
    }
    setInquiryBulkAssignSaving(true);
    try {
      const res = await fetch("/api/ops/inquiry/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: ids, assigneeUsername: assignee }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
        alert(typeof err === "string" && err.trim() ? err : "批量分配失败");
        return;
      }
      setInquiryBulkAssignOpen(false);
      setInquiryBulkAssignPerson("");
      setInquirySelectedIds(new Set());
      await load();
    } finally {
      setInquiryBulkAssignSaving(false);
    }
  }

  async function saveInquiryBulkEdit(mode: "confirm" | "submit") {
    if (inquiryBulkEditSaving) return;
    if (workspaceKey !== "ops.inquiry") return;
    const ids = inquiryBulkEditIds.length > 0 ? inquiryBulkEditIds : Array.from(inquirySelectedIds);
    if (ids.length === 0) return;
    const selected = records.filter((r) => ids.includes(r.id));
    if (selected.length === 0) return;

    const unitPrice = inquiryBulkEditForm.productUnitPrice.trim();
    const moq = inquiryBulkEditForm.moq.trim();
    const discountPolicy = inquiryBulkEditForm.discountPolicy.trim();
    const discountNote = inquiryBulkEditForm.discountNote.trim();
    const packageLengthCm = inquiryBulkEditForm.packageLengthCm.trim();
    const packageWidthCm = inquiryBulkEditForm.packageWidthCm.trim();
    const packageHeightCm = inquiryBulkEditForm.packageHeightCm.trim();
    const packageWeightKg = inquiryBulkEditForm.packageWeightKg.trim();
    const mainProcess = inquiryBulkEditForm.mainProcess.trim();
    const factoryLocation = inquiryBulkEditForm.factoryLocation.trim();
    const factoryContact = inquiryBulkEditForm.factoryContact.trim();
    const factoryPhone = inquiryBulkEditForm.factoryPhone.trim();

    const hasAnyChange =
      !!unitPrice ||
      !!moq ||
      !!discountPolicy ||
      (discountPolicy === "有" && !!discountNote) ||
      !!packageLengthCm ||
      !!packageWidthCm ||
      !!packageHeightCm ||
      !!packageWeightKg ||
      !!mainProcess ||
      !!factoryLocation ||
      !!factoryContact ||
      !!factoryPhone;

    if (!hasAnyChange && mode === "confirm") {
      alert("请先填写需要批量修改的字段（留空表示不修改）");
      return;
    }

    setInquiryBulkEditAction(mode);
    setInquiryBulkEditSaving(true);
    try {
      for (const row of selected) {
        const obj = toRecordStringUnknown(row.data);
        const nextData: Record<string, unknown> = { ...obj };

        if (unitPrice) nextData["产品单价"] = unitPrice;
        if (moq) nextData["起订量"] = moq;
        if (packageLengthCm) nextData["单套尺寸-长（厘米）"] = packageLengthCm;
        if (packageWidthCm) nextData["单套尺寸-宽（厘米）"] = packageWidthCm;
        if (packageHeightCm) nextData["单套尺寸-高（厘米）"] = packageHeightCm;
        if (packageWeightKg) nextData["包裹实重（公斤）"] = packageWeightKg;
        if (mainProcess) nextData["主要工艺"] = mainProcess;
        if (factoryLocation) nextData["工厂所在地"] = factoryLocation;
        if (factoryContact) nextData["工厂联系人"] = factoryContact;
        if (factoryPhone) nextData["联系人电话"] = factoryPhone;

        if (discountPolicy) {
          nextData["优惠政策"] = discountPolicy;
          if (discountPolicy === "有") {
            if (discountNote) nextData["优惠政策备注"] = discountNote;
          } else {
            nextData["优惠政策备注"] = "";
          }
        }

        if (mode === "submit") nextData["状态"] = "待分配运营者";

        const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: nextData }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          const err =
            json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
          alert(typeof err === "string" && err.trim() ? err : `ID ${row.id} 修改失败`);
          return;
        }
      }

      setInquiryBulkEditOpen(false);
      setInquiryBulkEditSaving(false);
      setInquiryBulkEditIds([]);
      setInquiryBulkEditSpecs([]);
      setInquiryBulkEditForm({
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
      setInquirySelectedIds(new Set());
      await load();
    } finally {
      setInquiryBulkEditSaving(false);
      setInquiryBulkEditAction(null);
    }
  }

  function openImageViewer(urls: string[], index = 0) {
    const clean = urls.filter(looksLikeImagePath);
    if (clean.length === 0) return;
    const nextIndex = Math.max(0, Math.min(clean.length - 1, index));
    setImageViewer({ urls: clean, index: nextIndex });
  }

  function closeImageViewer() {
    setImageViewer(null);
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
        productImages: String(obj["产品图片"] ?? ""),
        referenceLinks: String(obj["参考链接"] ?? ""),
        productSpec: String(obj["产品规格"] ?? ""),
        productUnitPrice: String(obj["产品单价"] ?? ""),
        moq: String(obj["起订量"] ?? ""),
        discountPolicy: ((obj["优惠政策"] ?? "") as "" | "有" | "无") || "",
        discountNote: String(obj["优惠政策备注"] ?? ""),
        deliveryCycle: String(obj["交货周期"] ?? ""),
        packageLengthCm: String(obj["单套尺寸-长（厘米）"] ?? ""),
        packageWidthCm: String(obj["单套尺寸-宽（厘米）"] ?? ""),
        packageHeightCm: String(obj["单套尺寸-高（厘米）"] ?? ""),
        packageWeightKg: String(obj["包裹实重（公斤）"] ?? ""),
        mainProcess: String(obj["主要工艺"] ?? ""),
        factoryLocation: String(obj["工厂所在地"] ?? ""),
        factoryContact: String(obj["工厂联系人"] ?? ""),
        factoryPhone: String(obj["联系人电话"] ?? ""),
        purchaseCost: String(obj["采购成本"] ?? ""),
        usdRate: String(obj["美元汇率"] ?? ""),
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
    const drafts: Record<string, string[]> = {};
    if (schema.fields.includes("参考链接")) {
      const links = parseDelimitedValues(data["参考链接"] ?? "");
      drafts["参考链接"] = links.length > 0 ? links : [""];
    }
    if (schema.fields.includes("产品规格")) {
      const specs = parseDelimitedValues(data["产品规格"] ?? "");
      drafts["产品规格"] = specs.length > 0 ? specs : [""];
    }

    let relatedIds: number[] = [];
    const specIdMap: Record<string, number[]> = {};
    const specSlotIds: number[] = [];

    if (workspaceKey === "ops.selection" && row.id && data["名称"]) {
      const name = data["名称"].trim();
      const siblings = records
        .filter((r) => {
        const d = toRecordStringUnknown(r.data);
        return String(d["名称"] ?? "").trim() === name;
        })
        .sort((a, b) => a.id - b.id);
      if (siblings.length > 0) {
        relatedIds = siblings.map((r) => r.id);
        if (schema.fields.includes("产品规格")) {
          const slotSpecs: string[] = [];
          for (const r of siblings) {
            const d = toRecordStringUnknown(r.data);
            const s = parseDelimitedValues(String(d["产品规格"] ?? ""));
            if (s.length === 0) {
              if (!specIdMap[""]) specIdMap[""] = [];
              specIdMap[""].push(r.id);
              slotSpecs.push("");
              specSlotIds.push(r.id);
            } else {
              for (const it of s) {
                const t = it.trim();
                if (!t) continue;
                if (!specIdMap[t]) specIdMap[t] = [];
                specIdMap[t].push(r.id);
                slotSpecs.push(t);
                specSlotIds.push(r.id);
              }
            }
          }
          const nextSpecs = slotSpecs.length > 0 ? slotSpecs : [""];
          data["产品规格"] = joinDelimitedValues(nextSpecs);
          drafts["产品规格"] = nextSpecs;
        }
      }
    }

    setLinkDraftByField(drafts);
    setEditing({
      id: row.id,
      data: applyComputedFields(schema, data, lastMilePricing),
      relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
      specIdMap,
      specSlotIds: specSlotIds.length > 0 ? specSlotIds : undefined,
    });
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

  async function saveEdit(statusOrEvent?: string | unknown) {
    if (!editing) return;
    const overrideStatus = typeof statusOrEvent === "string" ? statusOrEvent : undefined;

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

    const referenceLinksOverride = (() => {
      if (!schema.fields.includes("参考链接")) return null;
      const raw = linkDraftByField["参考链接"] ?? parseDelimitedValues(String(editing.data["参考链接"] ?? ""));
      const out: string[] = [];
      const seen = new Set<string>();
      for (const it of raw) {
        const t = String(it ?? "").trim();
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out.length > 0 ? joinDelimitedValues(out) : "";
    })();

    for (const f of visibleFields) {
      if (f === "创建时间" || f === "最后更新时间") continue;
      if (f === "运营人员") continue;
      if (f === "产品规格输入方式") continue;
      const rawValue = f === "参考链接" && referenceLinksOverride != null ? referenceLinksOverride : (editing.data[f] ?? "");
      const v = String(rawValue).trim();
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
    const resolvedOverrideStatus =
      overrideStatus ?? (workspaceKey === "ops.selection" && !editing.id ? "待选品" : null);
    if (schema.fields.includes("状态") && resolvedOverrideStatus) payload["状态"] = resolvedOverrideStatus;
    if (!editing.id && schema.fields.includes("创建时间")) payload["创建时间"] = formatNow();
    if (schema.fields.includes("最后更新时间")) payload["最后更新时间"] = editing.id ? formatNow() : null;
    if (referenceLinksOverride != null) payload["参考链接"] = referenceLinksOverride;
    delete payload["产品规格输入方式"];

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

      if (!editing.id && specs.length > 0) {
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

    if (workspaceKey === "ops.selection" && editing.relatedIds && editing.relatedIds.length > 0) {
      const baseUrl = `/api/workspace/${encodeURIComponent(workspaceKey)}/records`;

      const formSpecsRaw = linkDraftByField["产品规格"] ?? parseDelimitedValues(String(payload["产品规格"] ?? ""));
      const normalizedSpecs = formSpecsRaw
        .map((it) => String(it ?? "").trim())
        .filter((it) => it.length > 0);
      const formSpecs = normalizedSpecs.length > 0 ? normalizedSpecs : [""];

      const existingIds = Array.from(new Set(editing.relatedIds)).sort((a, b) => a - b);
      const maxLen = Math.max(existingIds.length, formSpecs.length);

      for (let i = 0; i < maxLen; i++) {
        const id = i < existingIds.length ? existingIds[i] : null;
        const spec = i < formSpecs.length ? formSpecs[i] : null;

        if (id !== null && spec === null) {
          const res = await fetch(`${baseUrl}/${id}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) {
            const json = await res.json().catch(() => ({}));
            const err =
              json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
            alert(typeof err === "string" && err.trim() ? err : `删除失败 ID ${id}`);
            return;
          }
          continue;
        }

        if (id === null && spec !== null) {
          const nextData = { ...payload };
          if (schema.fields.includes("产品规格")) nextData["产品规格"] = spec;
          if (schema.fields.includes("产品规则")) nextData["产品规则"] = spec;
          if (schema.fields.includes("创建时间")) nextData["创建时间"] = formatNow();
          if (schema.fields.includes("最后更新时间")) nextData["最后更新时间"] = null;
          if (overrideStatus) nextData["状态"] = overrideStatus;

          const res = await fetch(baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: nextData }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            const err =
              json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
            alert(typeof err === "string" && err.trim() ? err : `创建失败 规格 ${spec}`);
            return;
          }
          continue;
        }

        if (id !== null && spec !== null) {
          const existingRow = records.find((r) => r.id === id);
          const existingObj = existingRow ? toRecordStringUnknown(existingRow.data) : {};
          const existingStatus = String(existingObj["状态"] ?? "").trim();

          const nextData = { ...payload };
          if (schema.fields.includes("产品规格")) nextData["产品规格"] = spec;
          if (schema.fields.includes("产品规则")) nextData["产品规则"] = spec;
          if (schema.fields.includes("状态") && existingStatus && !overrideStatus) nextData["状态"] = existingStatus;
          if (overrideStatus) nextData["状态"] = overrideStatus;

          const res = await fetch(`${baseUrl}/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: nextData }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            const err =
              json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
            alert(typeof err === "string" && err.trim() ? err : `更新失败 ID ${id}`);
            return;
          }
        }
      }

      setEditing(null);
      await load();
      return;
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
    if (workspaceKey === "ops.purchase" || workspaceKey === "ops.selection") {
      for (const f of PURCHASE_PRODUCT_SIZE_FIELDS) excluded.add(f);
    }
    if (workspaceKey === "ops.inquiry") {
      excluded.add("选品逻辑");
    }
    const list = visibleFields.slice(0, 12);
    return list.filter((f) => !excluded.has(f));
  }, [schema, visibleFields, workspaceKey]);

  const selectionStats = useMemo(() => {
    if (workspaceKey !== "ops.selection") return null;
    let pendingSelection = 0;
    let pendingInquiry = 0;
    let discarded = 0;
    for (const r of records) {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "");
      if (status === SELECTION_PENDING_STATUS_VALUE) pendingSelection++;
      if (status === INQUIRY_STATUS_VALUE) pendingInquiry++;
      if (status === SELECTION_ABANDON_STATUS_VALUE || status === "已放弃") discarded++;
    }
    const total = pendingSelection + pendingInquiry + discarded;
    const stats: {
      label: string;
      value: number;
      filter: SelectionStatusFilter;
      icon: typeof Users;
      color: string;
      bg: string;
      borderColor: string;
      iconBg: string;
    }[] = [
      {
        label: "全部待选商品",
        value: total,
        filter: "",
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-slate-100",
      },
      {
        label: SELECTION_PENDING_STATUS_VALUE,
        value: pendingSelection,
        filter: SELECTION_PENDING_STATUS_VALUE,
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-slate-100",
      },
      {
        label: "待分配【询价】",
        value: pendingInquiry,
        filter: "待分配【询价】",
        icon: Clock,
        color: "text-orange-500",
        bg: "bg-white",
        borderColor: "border-orange-200",
        iconBg: "bg-orange-50",
      },
      {
        label: SELECTION_ABANDON_STATUS_VALUE,
        value: discarded,
        filter: SELECTION_ABANDON_STATUS_VALUE,
        icon: XCircle,
        color: "text-red-500",
        bg: "bg-white",
        borderColor: "border-red-200",
        iconBg: "bg-red-50",
      },
    ];
    return stats;
  }, [records, workspaceKey]);

  const selectionFilteredRecords = useMemo(() => {
    if (workspaceKey !== "ops.selection") return records;
    if (selectionHistoryMode) return selectionHistoryRecords;
    if (!selectionStatusFilter) {
      return records.filter((r) => {
        const d = toRecordStringUnknown(r.data);
        const status = String(d["状态"] ?? "").trim();
        return (
          status === SELECTION_PENDING_STATUS_VALUE ||
          status === INQUIRY_STATUS_VALUE ||
          status === SELECTION_ABANDON_STATUS_VALUE ||
          status === "已放弃"
        );
      });
    }
    return records.filter((r) => {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "").trim();
      if (selectionStatusFilter === SELECTION_ABANDON_STATUS_VALUE) {
        return status === SELECTION_ABANDON_STATUS_VALUE || status === "已放弃";
      }
      return status === selectionStatusFilter;
    });
  }, [records, selectionHistoryMode, selectionHistoryRecords, selectionStatusFilter, workspaceKey]);

  const inquiryStats = useMemo(() => {
    if (workspaceKey !== "ops.inquiry") return null;
    let total = 0;
    let pending = 0;
    let needAssign = 0;
    let needAssignOperator = 0;
    for (const r of records) {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "");
      if (status === "待询价" || status === INQUIRY_STATUS_VALUE || status === "待分配运营者") total++;
      if (status === "待询价") pending++;
      if (status === INQUIRY_STATUS_VALUE) needAssign++;
      if (status === "待分配运营者") needAssignOperator++;
    }
    const stats: {
      label: string;
      value: number;
      filter: InquiryStatusFilter;
      icon: typeof Users;
      color: string;
      bg: string;
      borderColor: string;
      iconBg: string;
    }[] = [
      {
        label: "全部待询价商品",
        value: total,
        filter: "",
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-primary shadow-sm",
        iconBg: "bg-slate-100",
      },
      {
        label: "待询价",
        value: pending,
        filter: "待询价",
        icon: Clock,
        color: "text-blue-500",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-blue-50",
      },
      {
        label: INQUIRY_STATUS_VALUE,
        value: needAssign,
        filter: INQUIRY_STATUS_VALUE,
        icon: Clock,
        color: "text-orange-500",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-orange-50",
      },
      {
        label: "待分配运营者",
        value: needAssignOperator,
        filter: "待分配运营者",
        icon: Clock,
        color: "text-purple-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-purple-50",
      },
    ];
    return stats;
  }, [records, workspaceKey]);

  const inquiryFilteredRecords = useMemo(() => {
    if (workspaceKey !== "ops.inquiry") return records;
    if (inquiryHistoryMode) return inquiryHistoryRecords;
    if (!inquiryStatusFilter) {
      return records.filter((r) => {
        const d = toRecordStringUnknown(r.data);
        const status = String(d["状态"] ?? "").trim();
        return status === "待询价" || status === INQUIRY_STATUS_VALUE || status === "待分配运营者";
      });
    }
    return records.filter((r) => {
      const d = toRecordStringUnknown(r.data);
      return String(d["状态"] ?? "").trim() === inquiryStatusFilter;
    });
  }, [inquiryHistoryMode, inquiryHistoryRecords, inquiryStatusFilter, records, workspaceKey]);

  const pricingStats = useMemo(() => {
    if (workspaceKey !== "ops.pricing") return null;
    let total = 0;
    let pendingPricing = 0;
    let needAssign = 0;
    let pendingConfirm = 0;
    let discarded = 0;
    for (const r of records) {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "").trim();
      if (status === "待核价") {
        total++;
        pendingPricing++;
        continue;
      }
      if (status === "待分配运营者") {
        total++;
        needAssign++;
        continue;
      }
      if (status === "待确品") {
        total++;
        pendingConfirm++;
        continue;
      }
      if (status === "【核价】已放弃") {
        total++;
        discarded++;
      }
    }
    const stats: {
      label: string;
      value: number;
      filter: PricingStatusFilter;
      icon: typeof Users;
      color: string;
      bg: string;
      borderColor: string;
      iconBg: string;
    }[] = [
      {
        label: "全部待核价商品",
        value: total,
        filter: "",
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-primary shadow-sm",
        iconBg: "bg-slate-100",
      },
      {
        label: "待核价",
        value: pendingPricing,
        filter: "待核价",
        icon: Clock,
        color: "text-purple-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-purple-50",
      },
      {
        label: "待分配运营者",
        value: needAssign,
        filter: "待分配运营者",
        icon: Clock,
        color: "text-orange-500",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-orange-50",
      },
      {
        label: "待确品",
        value: pendingConfirm,
        filter: "待确品",
        icon: Clock,
        color: "text-blue-500",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-blue-50",
      },
      {
        label: "【核价】已放弃",
        value: discarded,
        filter: "【核价】已放弃",
        icon: XCircle,
        color: "text-red-500",
        bg: "bg-white",
        borderColor: "border-red-200",
        iconBg: "bg-red-50",
      },
    ];
    return stats;
  }, [records, workspaceKey]);

  const pricingFilteredRecords = useMemo(() => {
    if (workspaceKey !== "ops.pricing") return records;
    if (pricingHistoryMode) return pricingHistoryRecords;
    if (!pricingStatusFilter) {
      return records.filter((r) => {
        const d = toRecordStringUnknown(r.data);
        const status = String(d["状态"] ?? "").trim();
        return (
          status === "待核价" ||
          status === "待分配运营者" ||
          status === "待确品" ||
          status === "【核价】已放弃"
        );
      });
    }
    return records.filter((r) => {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "").trim();
      if (pricingStatusFilter === "【核价】已放弃") return status === "【核价】已放弃";
      return status === pricingStatusFilter;
    });
  }, [pricingHistoryMode, pricingHistoryRecords, pricingStatusFilter, records, workspaceKey]);

  const purchaseStats = useMemo(() => {
    if (workspaceKey !== "ops.purchase") return null;
    let pendingPurchase = 0;
    let pendingShip = 0;
    let arrived = 0;
    let shipped = 0;
    for (const r of records) {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "").trim();
      if (status === "待采购") pendingPurchase++;
      else if (status === "待发货") pendingShip++;
      else if (status === "已到仓") arrived++;
      else if (status === "已发运") shipped++;
    }
    const total = pendingPurchase + pendingShip;
    const stats: {
      label: string;
      value: number;
      filter: PurchaseStatusFilter;
      icon: typeof Users;
      color: string;
      bg: string;
      borderColor: string;
      iconBg: string;
    }[] = [
      {
        label: "全部待采购商品",
        value: total,
        filter: "",
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-primary shadow-sm",
        iconBg: "bg-slate-100",
      },
      {
        label: "待采购",
        value: pendingPurchase,
        filter: "待采购",
        icon: Clock,
        color: "text-purple-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-purple-50",
      },
      {
        label: "待发货",
        value: pendingShip,
        filter: "待发货",
        icon: Clock,
        color: "text-orange-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-orange-50",
      },
      {
        label: "已到仓",
        value: arrived,
        filter: "已到仓",
        icon: Clock,
        color: "text-blue-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-blue-50",
      },
      {
        label: "已发运",
        value: shipped,
        filter: "已发运",
        icon: Clock,
        color: "text-emerald-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-emerald-50",
      },
    ];
    return stats;
  }, [records, workspaceKey]);

  const purchaseFilteredRecords = useMemo(() => {
    if (workspaceKey !== "ops.purchase") return records;
    if (purchaseHistoryMode) return purchaseHistoryRecords;
    if (!purchaseStatusFilter) {
      return records.filter((r) => {
        const d = toRecordStringUnknown(r.data);
        const status = String(d["状态"] ?? "").trim();
        return status === "待采购" || status === "待发货";
      });
    }
    return records.filter((r) => {
      const d = toRecordStringUnknown(r.data);
      return String(d["状态"] ?? "").trim() === purchaseStatusFilter;
    });
  }, [purchaseHistoryMode, purchaseHistoryRecords, purchaseStatusFilter, records, workspaceKey]);

  const confirmStats = useMemo(() => {
    if (workspaceKey !== "ops.confirm") return null;
    let pendingConfirm = 0;
    let needPurchase = 0;
    let total = 0;
    for (const r of records) {
      const d = toRecordStringUnknown(r.data);
      const status = String(d["状态"] ?? "").trim();
      if (status === "待确品" || status === "待采购") total++;
      if (status === "待确品") pendingConfirm++;
      if (status === "待采购") needPurchase++;
    }
    const stats: {
      label: string;
      value: number;
      filter: ConfirmStatusFilter;
      icon: typeof Users;
      color: string;
      bg: string;
      borderColor: string;
      iconBg: string;
    }[] = [
      {
        label: "全部待确品商品",
        value: total,
        filter: "",
        icon: Users,
        color: "text-slate-600",
        bg: "bg-white",
        borderColor: "border-primary shadow-sm",
        iconBg: "bg-slate-100",
      },
      {
        label: "待确品",
        value: pendingConfirm,
        filter: "待确品",
        icon: Clock,
        color: "text-blue-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-blue-50",
      },
      {
        label: "待采购",
        value: needPurchase,
        filter: "待采购",
        icon: Clock,
        color: "text-orange-600",
        bg: "bg-white",
        borderColor: "border-slate-200",
        iconBg: "bg-orange-50",
      },
    ];
    return stats;
  }, [records, workspaceKey]);

  const confirmFilteredRecords = useMemo(() => {
    if (workspaceKey !== "ops.confirm") return records;
    if (confirmHistoryMode) return confirmHistoryRecords;
    if (!confirmStatusFilter) {
      return records.filter((r) => {
        const d = toRecordStringUnknown(r.data);
        const status = String(d["状态"] ?? "").trim();
        return status === "待确品" || status === "待采购";
      });
    }
    return records.filter((r) => {
      const d = toRecordStringUnknown(r.data);
      return String(d["状态"] ?? "").trim() === confirmStatusFilter;
    });
  }, [confirmHistoryMode, confirmHistoryRecords, confirmStatusFilter, records, workspaceKey]);

  const inquiryTableExtraFields = useMemo(() => {
    if (workspaceKey !== "ops.inquiry") return [];
    const excluded = new Set([
      "名称",
      "产品图片",
      "参考链接",
      "所属类目",
      "产品规格",
      "预计周平均日销量",
      "建议采购价",
      "热销月份",
      "选品逻辑",
      "产品尺寸-长（厘米）",
      "产品尺寸-宽（厘米）",
      "产品尺寸-高（厘米）",
      "产品重量",
      "单套尺寸-长（厘米）",
      "单套尺寸-宽（厘米）",
      "单套尺寸-高（厘米）",
      "包裹实重（公斤）",
      "包裹体积（立方厘米）",
      "体积重系数",
      "体积重",
      "包裹计费重",
      "包裹计费重（磅）",
      "单套尺寸-长（英寸）",
      "单套尺寸-宽（英寸）",
      "单套尺寸-高（英寸）",
      "包裹实物包装图",
      "箱规",
      "外箱尺寸-长（厘米）",
      "外箱尺寸-宽（厘米）",
      "外箱尺寸-高（厘米）",
      "外箱体积",
      "外箱体积系数",
      "外箱体积重",
      "外箱实重",
      "外箱计费重",
    ]);
    return tableFields.filter((f) => !excluded.has(f));
  }, [tableFields, workspaceKey]);

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
              {hideInquiryCreateButton || workspaceKey === "ops.inquiry" ? null : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  onClick={openInquiryCreate}
                >
                  新增询价数据
                </button>
              )}
              {!secondaryCreateButtonLabel ? null : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  onClick={openSecondaryCreate}
                >
                  {secondaryCreateButtonLabel}
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
          {workspaceKey === "ops.selection" ||
          workspaceKey === "ops.inquiry" ||
          workspaceKey === "ops.pricing" ||
          workspaceKey === "ops.purchase" ||
          workspaceKey === "ops.confirm" ? null : (
            <a
              href={exportUrl}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
            >
              导出Excel
            </a>
          )}
        </div>
      </div>

      {selectionStats ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {selectionStats.map((item) => (
            <button
              type="button"
              key={item.label}
              className={[
                "flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-surface-2",
                item.bg,
                item.borderColor,
                !selectionHistoryMode && selectionStatusFilter === item.filter ? "ring-2 ring-primary/20" : "",
                selectionHistoryMode ? "opacity-60" : "",
              ].join(" ")}
              onClick={() => {
                setSelectionHistoryMode(false);
                setSelectionStatusFilter(selectionStatusFilter === item.filter ? "" : item.filter);
              }}
            >
              <div>
                <div className="text-sm font-medium text-muted">{item.label}</div>
                <div className="mt-1 text-2xl font-bold">{item.value}</div>
              </div>
              <div className={`rounded-lg p-2 ${item.iconBg}`}>
                <item.icon className={`h-6 w-6 ${item.color}`} />
              </div>
            </button>
          ))}
          </div>
          <div className="flex">
            <button
              type="button"
              className={[
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                selectionHistoryMode
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface hover:bg-surface-2 text-foreground",
              ].join(" ")}
              onClick={() => {
                if (selectionHistoryMode) {
                  setSelectionHistoryMode(false);
                  return;
                }
                setSelectionHistoryMode(true);
                setSelectionHistoryLoading(true);
                fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records?myHistory=true`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text();
                    if (!r.ok) return null;
                    try { return JSON.parse(text); } catch { return null; }
                  })
                  .then((json) => {
                    const raw = json && typeof json === "object" && "records" in json ? (json as { records?: unknown }).records : null;
                    if (!Array.isArray(raw)) { setSelectionHistoryRecords([]); return; }
                    const rows: RecordRow[] = [];
                    for (const it of raw) {
                      const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
                      if (!obj) continue;
                      const id = typeof obj.id === "number" ? obj.id : null;
                      const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : "";
                      if (id == null) continue;
                      rows.push({ id, updated_at, data: obj.data });
                    }
                    setSelectionHistoryRecords(rows);
                  })
                  .catch(() => setSelectionHistoryRecords([]))
                  .finally(() => setSelectionHistoryLoading(false));
              }}
              disabled={selectionHistoryLoading}
            >
              {selectionHistoryLoading ? "加载中…" : selectionHistoryMode ? "退出历史数据" : "查看历史数据"}
            </button>
          </div>
        </div>
      ) : null}

      {inquiryStats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {inquiryStats.map((item) => (
              <button
                type="button"
                key={item.label}
                className={[
                  "flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-surface-2",
                  item.bg,
                  item.borderColor,
                  !inquiryHistoryMode && inquiryStatusFilter === item.filter ? "ring-2 ring-primary/20" : "",
                  inquiryHistoryMode ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => {
                  setInquiryHistoryMode(false);
                  if (!item.filter) {
                    setInquiryStatusFilter("");
                    return;
                  }
                  setInquiryStatusFilter(inquiryStatusFilter === item.filter ? "" : item.filter);
                }}
              >
                <div>
                  <div className="text-sm font-medium text-muted">{item.label}</div>
                  <div className="mt-1 text-2xl font-bold">{item.value}</div>
                </div>
                <div className={`rounded-lg p-2 ${item.iconBg}`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              className={[
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                inquiryHistoryMode
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface hover:bg-surface-2 text-foreground",
              ].join(" ")}
              onClick={() => {
                if (inquiryHistoryMode) {
                  setInquiryHistoryMode(false);
                  return;
                }
                setInquiryHistoryMode(true);
                setInquiryHistoryLoading(true);
                fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records?myHistory=true`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text();
                    if (!r.ok) { console.error("[inquiryHistory] error", text); return null; }
                    try { return JSON.parse(text); } catch { return null; }
                  })
                  .then((json) => {
                    const raw = json && typeof json === "object" && "records" in json ? (json as { records?: unknown }).records : null;
                    if (!Array.isArray(raw)) { setInquiryHistoryRecords([]); return; }
                    const rows: RecordRow[] = [];
                    for (const it of raw) {
                      const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
                      if (!obj) continue;
                      const id = typeof obj.id === "number" ? obj.id : null;
                      const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : "";
                      if (id == null) continue;
                      rows.push({ id, updated_at, data: obj.data });
                    }
                    setInquiryHistoryRecords(rows);
                  })
                  .catch(() => setInquiryHistoryRecords([]))
                  .finally(() => setInquiryHistoryLoading(false));
              }}
              disabled={inquiryHistoryLoading}
            >
              {inquiryHistoryLoading ? "加载中…" : inquiryHistoryMode ? "退出历史数据" : "查看历史数据"}
            </button>
          </div>
        </>
      ) : null}

      {pricingStats ? (
        <>
          <div
            className={[
              "grid grid-cols-1 gap-4",
              pricingStats.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
            ].join(" ")}
          >
            {pricingStats.map((item) => (
              <button
                type="button"
                key={item.label}
                className={[
                  "flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-surface-2",
                  item.bg,
                  item.borderColor,
                  !pricingHistoryMode && pricingStatusFilter === item.filter ? "ring-2 ring-primary/20" : "",
                  pricingHistoryMode ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => {
                  setPricingHistoryMode(false);
                  if (!item.filter) {
                    setPricingStatusFilter("");
                    return;
                  }
                  setPricingStatusFilter(pricingStatusFilter === item.filter ? "" : item.filter);
                }}
              >
                <div>
                  <div className="text-sm font-medium text-muted">{item.label}</div>
                  <div className="mt-1 text-2xl font-bold">{item.value}</div>
                </div>
                <div className={`rounded-lg p-2 ${item.iconBg}`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              className={[
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                pricingHistoryMode
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface hover:bg-surface-2 text-foreground",
              ].join(" ")}
              onClick={() => {
                if (pricingHistoryMode) {
                  setPricingHistoryMode(false);
                  return;
                }
                setPricingHistoryMode(true);
                setPricingHistoryLoading(true);
                fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records?myHistory=true`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text();
                    if (!r.ok) { console.error("[pricingHistory] error", text); return null; }
                    try { return JSON.parse(text); } catch { return null; }
                  })
                  .then((json) => {
                    const raw = json && typeof json === "object" && "records" in json ? (json as { records?: unknown }).records : null;
                    if (!Array.isArray(raw)) { setPricingHistoryRecords([]); return; }
                    const rows: RecordRow[] = [];
                    for (const it of raw) {
                      const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
                      if (!obj) continue;
                      const id = typeof obj.id === "number" ? obj.id : null;
                      const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : "";
                      if (id == null) continue;
                      rows.push({ id, updated_at, data: obj.data });
                    }
                    setPricingHistoryRecords(rows);
                  })
                  .catch(() => setPricingHistoryRecords([]))
                  .finally(() => setPricingHistoryLoading(false));
              }}
              disabled={pricingHistoryLoading}
            >
              {pricingHistoryLoading ? "加载中…" : pricingHistoryMode ? "退出历史数据" : "查看历史数据"}
            </button>
          </div>
        </>
      ) : null}

      {purchaseStats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
            {purchaseStats.map((item) => (
              <button
                type="button"
                key={item.label}
                className={[
                  "flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-surface-2",
                  item.bg,
                  item.borderColor,
                  !purchaseHistoryMode && purchaseStatusFilter === item.filter ? "ring-2 ring-primary/20" : "",
                  purchaseHistoryMode ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => {
                  setPurchaseHistoryMode(false);
                  setPurchaseStatusFilter(purchaseStatusFilter === item.filter ? "" : item.filter);
                }}
              >
                <div>
                  <div className="text-sm font-medium text-muted">{item.label}</div>
                  <div className="mt-1 text-2xl font-bold">{item.value}</div>
                </div>
                <div className={`rounded-lg p-2 ${item.iconBg}`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              className={[
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                purchaseHistoryMode
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface hover:bg-surface-2 text-foreground",
              ].join(" ")}
              onClick={() => {
                if (purchaseHistoryMode) {
                  setPurchaseHistoryMode(false);
                  return;
                }
                setPurchaseHistoryMode(true);
                setPurchaseHistoryLoading(true);
                fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records?myHistory=true`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text();
                    if (!r.ok) { console.error("[purchaseHistory] error", text); return null; }
                    try { return JSON.parse(text); } catch { return null; }
                  })
                  .then((json) => {
                    const raw = json && typeof json === "object" && "records" in json ? (json as { records?: unknown }).records : null;
                    if (!Array.isArray(raw)) { setPurchaseHistoryRecords([]); return; }
                    const rows: RecordRow[] = [];
                    for (const it of raw) {
                      const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
                      if (!obj) continue;
                      const id = typeof obj.id === "number" ? obj.id : null;
                      const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : "";
                      if (id == null) continue;
                      rows.push({ id, updated_at, data: obj.data });
                    }
                    setPurchaseHistoryRecords(rows);
                  })
                  .catch(() => setPurchaseHistoryRecords([]))
                  .finally(() => setPurchaseHistoryLoading(false));
              }}
              disabled={purchaseHistoryLoading}
            >
              {purchaseHistoryLoading ? "加载中…" : purchaseHistoryMode ? "退出历史数据" : "查看历史数据"}
            </button>
          </div>
        </>
      ) : null}

      {confirmStats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {confirmStats.map((item) => (
              <button
                type="button"
                key={item.label}
                className={[
                  "flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-surface-2",
                  item.bg,
                  item.borderColor,
                  !confirmHistoryMode && confirmStatusFilter === item.filter ? "ring-2 ring-primary/20" : "",
                  confirmHistoryMode ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => {
                  setConfirmHistoryMode(false);
                  setConfirmStatusFilter(confirmStatusFilter === item.filter ? "" : item.filter);
                }}
              >
                <div>
                  <div className="text-sm font-medium text-muted">{item.label}</div>
                  <div className="mt-1 text-2xl font-bold">{item.value}</div>
                </div>
                <div className={`rounded-lg p-2 ${item.iconBg}`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              className={[
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                confirmHistoryMode
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface hover:bg-surface-2 text-foreground",
              ].join(" ")}
              onClick={() => {
                if (confirmHistoryMode) {
                  setConfirmHistoryMode(false);
                  return;
                }
                setConfirmHistoryMode(true);
                setConfirmHistoryLoading(true);
                fetch(`/api/workspace/${encodeURIComponent(workspaceKey)}/records?myHistory=true`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text();
                    if (!r.ok) { console.error("[confirmHistory] error", text); return null; }
                    try { return JSON.parse(text); } catch { return null; }
                  })
                  .then((json) => {
                    const raw = json && typeof json === "object" && "records" in json ? (json as { records?: unknown }).records : null;
                    if (!Array.isArray(raw)) { setConfirmHistoryRecords([]); return; }
                    const rows: RecordRow[] = [];
                    for (const it of raw) {
                      const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
                      if (!obj) continue;
                      const id = typeof obj.id === "number" ? obj.id : null;
                      const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : "";
                      if (id == null) continue;
                      rows.push({ id, updated_at, data: obj.data });
                    }
                    setConfirmHistoryRecords(rows);
                  })
                  .catch(() => setConfirmHistoryRecords([]))
                  .finally(() => setConfirmHistoryLoading(false));
              }}
              disabled={confirmHistoryLoading}
            >
              {confirmHistoryLoading ? "加载中…" : confirmHistoryMode ? "退出历史数据" : "查看历史数据"}
            </button>
          </div>
        </>
      ) : null}

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3">
          {schema ? (
            workspaceKey === "ops.selection" ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={filters["名称"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 名称: e.target.value }))}
                      placeholder="商品名称"
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <select
                      value={filters["所属类目"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 所属类目: e.target.value }))}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                    const next = e.target.value as typeof timeRange;
                    setTimeRange(next);
                    if (next !== "custom") {
                      setCustomStartDate("");
                      setCustomEndDate("");
                    }
                  }}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="yesterday">昨天</option>
                      <option value="this_week">本周</option>
                      <option value="last_week">上周</option>
                      <option value="this_month">本月</option>
                      <option value="last_month">上月</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={
                        loading ||
                        (timeRange === "custom" &&
                          (!customStartDate || !customEndDate || customStartDate > customEndDate))
                      }
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                      onClick={load}
                    >
                      {loading ? "查询中…" : "查询"}
                    </button>
                  </div>
                </div>
                {timeRange === "custom" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">开始日期</div>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">结束日期</div>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : workspaceKey === "ops.inquiry" ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={filters["名称"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 名称: e.target.value }))}
                      placeholder="商品名称"
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <select
                      value={filters["所属类目"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 所属类目: e.target.value }))}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                        const next = e.target.value as "" | "today" | "7d" | "30d" | "custom";
                        setTimeRange(next);
                        if (next !== "custom") {
                          setCustomStartDate("");
                          setCustomEndDate("");
                        }
                      }}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                </div>
                {timeRange === "custom" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">开始日期</div>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">结束日期</div>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {canInquiryBulkAssign ? (
                      <button
                        type="button"
                        className={[
                          "inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm disabled:opacity-50",
                          inquirySelectedIds.size > 0
                            ? "border border-primary bg-surface text-primary hover:bg-primary hover:text-white"
                            : "bg-surface-2 text-muted",
                        ].join(" ")}
                        disabled={inquirySelectedIds.size === 0}
                        onClick={openInquiryBulkAssign}
                      >
                        批量分配
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={[
                        "inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm disabled:opacity-50",
                        canInquiryBulkEdit
                          ? "border border-primary bg-surface text-primary hover:bg-primary hover:text-white"
                          : "bg-surface-2 text-muted",
                      ].join(" ")}
                      disabled={!canInquiryBulkEdit}
                      title={
                        canInquiryBulkEdit
                          ? "批量修改"
                          : inquirySelectedIds.size === 0
                            ? "请先选择记录"
                            : `需选中 1 条；或选中多条且商品名称一致；且状态不为 ${INQUIRY_STATUS_VALUE}`
                      }
                      onClick={openInquiryBulkEdit}
                    >
                      批量修改数据
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      (timeRange === "custom" &&
                        (!customStartDate || !customEndDate || customStartDate > customEndDate))
                    }
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-surface px-6 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                    onClick={load}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {loading ? "查询中…" : "查询"}
                  </button>
                </div>
              </div>
            ) : workspaceKey === "ops.pricing" ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={filters["名称"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 名称: e.target.value }))}
                      placeholder="商品名称"
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <select
                      value={filters["所属类目"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 所属类目: e.target.value }))}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                        const next = e.target.value as "" | "today" | "7d" | "30d" | "custom";
                        setTimeRange(next);
                        if (next !== "custom") {
                          setCustomStartDate("");
                          setCustomEndDate("");
                        }
                      }}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                </div>
                {timeRange === "custom" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">开始日期</div>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">结束日期</div>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  {canSeePricingBulkAssign ? (
                    <button
                      type="button"
                      className={[
                        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm disabled:opacity-50",
                        canPricingBulkAssign ? "bg-primary text-white hover:bg-primary/90" : "bg-surface-2 text-muted",
                      ].join(" ")}
                      disabled={!canPricingBulkAssign}
                      onClick={() => openPricingBulkAssign("bulk")}
                    >
                      <Users className="h-4 w-4" />
                      批量分配{pricingSelectedIds.size > 0 ? `（${pricingSelectedIds.size}）` : ""}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      loading ||
                      (timeRange === "custom" &&
                        (!customStartDate || !customEndDate || customStartDate > customEndDate))
                    }
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    onClick={load}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {loading ? "查询中…" : "查询"}
                  </button>
                </div>
              </div>
            ) : workspaceKey === "ops.purchase" ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_1fr_240px_120px]">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">商品名称</div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        value={filters["名称"] ?? ""}
                        onChange={(e) => setFilters((prev) => ({ ...prev, 名称: e.target.value }))}
                        placeholder="商品名称"
                        className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">所属类目</div>
                    <select
                      value={filters["所属类目"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 所属类目: e.target.value }))}
                      className="h-11 rounded-xl border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                        const next = e.target.value as "" | "today" | "7d" | "30d";
                        setTimeRange(next);
                      }}
                      className="h-11 rounded-xl border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-white px-6 text-sm font-medium text-foreground shadow-sm hover:bg-surface-2 disabled:opacity-50"
                    onClick={load}
                  >
                    {loading ? "查询中…" : "查询"}
                  </button>
                </div>
              </div>
            ) : workspaceKey === "ops.confirm" ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_1fr_240px_140px]">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">商品名称</div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        value={filters["名称"] ?? ""}
                        onChange={(e) => setFilters((prev) => ({ ...prev, 名称: e.target.value }))}
                        placeholder="搜索商品名称..."
                        className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">所属类目</div>
                    <select
                      value={filters["所属类目"] ?? ""}
                      onChange={(e) => setFilters((prev) => ({ ...prev, 所属类目: e.target.value }))}
                      className="h-11 rounded-xl border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                        const next = e.target.value as "" | "today" | "7d" | "30d";
                        setTimeRange(next);
                      }}
                      className="h-11 rounded-xl border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
                    onClick={load}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {loading ? "查询中…" : "查询"}
                  </button>
                </div>
              </div>
            ) : (
            <div className="flex flex-col gap-3">
              <div
                className={[
                  "grid gap-3",
                  workspaceKey === "ops.inquiry" ||
                  workspaceKey === "ops.purchase" ||
                  workspaceKey === "ops.selection"
                    ? "sm:grid-cols-4"
                    : "sm:grid-cols-3",
                ].join(" ")}
              >
                {filterFields.map((f) => (
                  (workspaceKey === "ops.inquiry" ||
                    workspaceKey === "ops.purchase" ||
                    workspaceKey === "ops.selection") &&
                  (f === "名称" || f === "所属类目") ? (
                    <div key={f} className="flex flex-col gap-1">
                      <div className="text-xs text-muted">{displayFieldLabel(f)}</div>
                      {f === "所属类目" ? (
                        <select
                          value={filters[f] ?? ""}
                          onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}
                          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                        >
                          <option value="">请选择</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={filters[f] ?? ""}
                          onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}
                          placeholder={displayFieldLabel(f)}
                          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                        />
                      )}
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
                {workspaceKey === "ops.inquiry" || workspaceKey === "ops.purchase" || workspaceKey === "ops.selection" ? (
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
                      <option value="待分配运营者">待分配运营者</option>
                      <option value="待确品">待确品</option>
                      <option value="待分配【采购】">待分配【采购】</option>
                      <option value="待采购">待采购</option>
                      <option value="已到仓">已到仓</option>
                    </select>
                  </div>
                ) : null}
                {workspaceKey === "ops.inquiry" || workspaceKey === "ops.purchase" || workspaceKey === "ops.selection" ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">时间范围</div>
                    <select
                      value={timeRange}
                      onChange={(e) => {
                        const next = e.target.value as "" | "today" | "7d" | "30d" | "custom";
                        setTimeRange(next);
                        if (next !== "custom") {
                          setCustomStartDate("");
                          setCustomEndDate("");
                        }
                      }}
                      className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="today">今天</option>
                      <option value="7d">7日内</option>
                      <option value="30d">30天内</option>
                      <option value="custom">自定义</option>
                    </select>
                    {timeRange === "custom" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={(e) => setCustomStartDate(e.target.value)}
                          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                        />
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <select
                    value={timeRange}
                    onChange={(e) => {
                      const next = e.target.value as "" | "today" | "7d" | "30d" | "custom";
                      setTimeRange(next);
                      if (next !== "custom") {
                        setCustomStartDate("");
                        setCustomEndDate("");
                      }
                    }}
                    className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
                  >
                    <option value="">请选择</option>
                    <option value="today">今天</option>
                    <option value="7d">7日内</option>
                    <option value="30d">30天内</option>
                    <option value="custom">自定义</option>
                  </select>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {workspaceKey === "ops.inquiry" ? (
                    canInquiryBulkAssign ? (
                    <button
                      type="button"
                      className={[
                        "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm disabled:opacity-50",
                        inquirySelectedIds.size > 0
                          ? "border-primary bg-surface text-primary hover:bg-primary hover:text-white"
                          : "border-border bg-surface hover:bg-surface-2",
                      ].join(" ")}
                      disabled={inquirySelectedIds.size === 0}
                      onClick={openInquiryBulkAssign}
                    >
                      批量分配询价人{inquirySelectedIds.size > 0 ? `（${inquirySelectedIds.size}）` : ""}
                    </button>
                    ) : null
                  ) : null}
                  {workspaceKey === "ops.inquiry" ? (
                    <button
                      type="button"
                      className={[
                        "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm disabled:opacity-50",
                        canInquiryBulkEdit
                          ? "border-primary bg-surface text-primary hover:bg-primary hover:text-white"
                          : "border-border bg-surface hover:bg-surface-2",
                      ].join(" ")}
                      disabled={!canInquiryBulkEdit}
                      title={
                        canInquiryBulkEdit
                          ? "批量修改"
                          : inquirySelectedIds.size === 0
                            ? "请先选择记录"
                            : `需选中 1 条；或选中多条且商品名称一致；且状态不为 ${INQUIRY_STATUS_VALUE}`
                      }
                      onClick={openInquiryBulkEdit}
                    >
                      批量修改数据{inquirySelectedIds.size > 0 ? `（${inquirySelectedIds.size}）` : ""}
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={
                    loading ||
                    (timeRange === "custom" &&
                      (!customStartDate || !customEndDate || customStartDate > customEndDate))
                  }
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                  onClick={load}
                >
                  {loading ? "查询中…" : "查询"}
                </button>
              </div>
            </div>
          )) : (
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
              workspaceKey === "ops.selection" ? (
                <div className="overflow-auto">
                  <table className="min-w-max border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-surface-2 text-xs text-muted">
                        <th className="whitespace-nowrap border-b border-border px-2 py-2 text-left">商品信息</th>
                        <th className="whitespace-nowrap border-b border-border px-2 py-2 text-left">参考链接</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">售价 (MIN/MAX)</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">所属类目</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">产品属性 (CM/KG)</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">预计周均日销</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">资质要求</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">专利风险</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">选品逻辑</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">状态</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectionFilteredRecords.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-3 py-6 text-center text-sm text-muted">
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                  selectionFilteredRecords.map((row) => {
                    const d = toRecordStringUnknown(row.data);
                    const images = parseDelimitedValues(String(d["产品图片"] ?? "")).filter(looksLikeImagePath);
                    const firstImage = images[0] || "";
                    const name = String(d["名称"] ?? "—");
                    const links = parseDelimitedValues(String(d["参考链接"] ?? "")).filter(looksLikeUrl);
                    const minPrice = String(d["平台在售价格（Min）"] ?? "").trim() || "—";
                    const maxPrice = String(d["平台在售价格（Max）"] ?? "").trim() || "—";
                    const priceMode = String(d["平台在售价格模式"] ?? "").trim();
                    const priceDisplay = priceMode === "固定价格" ? minPrice : `Min: ${minPrice} / Max: ${maxPrice}`;
                    const category = String(d["所属类目"] ?? "—");
                    const rawDimList = String(d["产品尺寸列表"] ?? "").trim();
                    const l = String(d["产品尺寸-长（厘米）"] ?? "");
                    const w = String(d["产品尺寸-宽（厘米）"] ?? "");
                    const h = String(d["产品尺寸-高（厘米）"] ?? "");
                    const size = rawDimList
                      ? rawDimList.split(/[，,\r\n]+/).map((item) => {
                          const parts = item.trim().split("×");
                          return [(parts[0] ?? "").trim(), (parts[1] ?? "").trim(), (parts[2] ?? "").trim()].filter(Boolean).join("x");
                        }).filter(Boolean).join(" / ") || "—"
                      : ([l, w, h].filter(Boolean).join("x") || "—");
                    const weight = String(d["产品重量"] ?? "—");
                    const specs = String(d["产品规格"] ?? "—");
                    const weeklySales = String(d["预计周平均日销量"] ?? "—");
                    const qualification = String(d["资质要求"] ?? "—");
                    const patentRisk = String(d["是否有专利风险"] ?? "—");
                    const selectionLogic = String(d["选品逻辑"] ?? "—");
                    const status = String(d["状态"] ?? "—");

                          return (
                            <tr key={row.id} className="hover:bg-surface-2">
                              <td className="border-b border-border px-2 py-2 align-top">
                                <div className="flex gap-2">
                                  {firstImage ? (
                                    <div
                                      className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-surface-2"
                                      onClick={() => openImageViewer(images, 0)}
                                    >
                                      <Image
                                        src={firstImage}
                                        alt={name}
                                        fill
                                        className="object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <div className="h-10 w-10 shrink-0 rounded-lg bg-surface-2" />
                                  )}
                                  <div>
                                    <div className="font-medium line-clamp-2 w-40" title={name}>
                                      {name}
                                    </div>
                                    <div className="text-xs text-muted">ID: {row.id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-2 py-2 align-top">
                                <div className="flex flex-col gap-1">
                                  {links.map((link, idx) => (
                                    <a
                                      key={idx}
                                      href={link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block max-w-[120px] truncate text-xs text-primary underline"
                                      title={link}
                                    >
                                      {links.length > 1 ? `链接 ${idx + 1}` : "链接"}
                                    </a>
                                  ))}
                                  {links.length === 0 ? <span className="text-muted">—</span> : null}
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top">
                                <div className="text-sm">{priceDisplay}</div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {category}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top">
                                <div className="space-y-0.5 text-xs text-muted">
                                  <div>尺寸: {size}</div>
                                  <div>重量: {weight}</div>
                                  <div>规格: {specs}</div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {weeklySales}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {qualification}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {patentRisk === "是" ? (
                                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                                    是
                                  </span>
                                ) : patentRisk === "否" ? (
                                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                    否
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {selectionLogic}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex items-center gap-1.5">
                                  <div className={`h-2 w-2 rounded-full ${status.includes("待分配") || status.includes("待询价") ? "bg-orange-500" : "bg-gray-300"}`} />
                                  <span>{status === "已放弃" ? SELECTION_ABANDON_STATUS_VALUE : status}</span>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-right">
                                <div className="flex justify-end gap-2">
                                  {selectionHistoryMode ? null : (() => {
                                    const locked =
                                      status === INQUIRY_STATUS_VALUE ||
                                      status === SELECTION_ABANDON_STATUS_VALUE ||
                                      status === "已放弃";
                                    return (
                                      <>
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => {
                                      if (locked) return;
                                      openEdit(row);
                                    }}
                                    disabled={locked}
                                  >
                                    修改
                                  </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-red-300 bg-surface px-3 text-xs text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      onClick={() => {
                                        if (locked) return;
                                        openSelectionAbandon(row);
                                      }}
                                      disabled={locked}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      放弃
                                    </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : workspaceKey === "ops.inquiry" ? (
                <div className="overflow-auto">
                  <table className="min-w-max border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-surface-2 text-xs text-muted">
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={
                              inquiryFilteredRecords.length > 0 &&
                              inquiryFilteredRecords.every((r) => inquirySelectedIds.has(r.id))
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setInquirySelectedIds((prev) => {
                                const next = new Set(prev);
                                if (!checked) {
                                  for (const r of inquiryFilteredRecords) next.delete(r.id);
                                  return next;
                                }
                                for (const r of inquiryFilteredRecords) next.add(r.id);
                                return next;
                              });
                            }}
                            aria-label="全选"
                          />
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">商品信息</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">参考链接</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">所属类目</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <span>产品属性</span>
                          <span className="ml-2 rounded-md bg-surface px-2 py-0.5 text-[10px] text-muted">CM/KG</span>
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <span>单套属性</span>
                          <span className="ml-2 rounded-md bg-surface px-2 py-0.5 text-[10px] text-muted">CM/KG</span>
                        </th>
                        {inquiryTableExtraFields.map((f) => (
                          <th key={f} className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                            {displayFieldLabel(f)}
                          </th>
                        ))}
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {inquiryFilteredRecords.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-sm text-muted" colSpan={7 + inquiryTableExtraFields.length}>
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        inquiryFilteredRecords.map((row) => {
                          const obj = toRecordStringUnknown(row.data);
                          const status = String(obj["状态"] ?? "").trim();
                          const canWithdraw = status === "待询价";
                          const name = String(obj["名称"] ?? "").trim() || "—";
                          const imageRaw = String(obj["产品图片"] ?? "");
                          const imageUrls = parseImageUrls(imageRaw);
                          const firstImageUrl = imageUrls[0] ?? "";
                          const category = String(obj["所属类目"] ?? "").trim() || "—";
                          const productSpec = String(obj["产品规格"] ?? "").trim();
                          const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
                          const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
                          const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
                          const pWeight = String(obj["产品重量"] ?? "").trim();
                          const productSize = pL || pW || pH ? `${pL || "—"}x${pW || "—"}x${pH || "—"}cm` : "—";
                          const packL = String(obj["单套尺寸-长（厘米）"] ?? "").trim();
                          const packW = String(obj["单套尺寸-宽（厘米）"] ?? "").trim();
                          const packH = String(obj["单套尺寸-高（厘米）"] ?? "").trim();
                          const packWeight = String(obj["包裹实重（公斤）"] ?? "").trim();
                          const packSize =
                            packL || packW || packH ? `${packL || "—"}x${packW || "—"}x${packH || "—"}cm` : "—";
                          const links = parseDelimitedValues(String(obj["参考链接"] ?? "")).filter(looksLikeUrl);
                          return (
                            <tr key={row.id} className="border-b border-border">
                              <td className="border-b border-border px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={inquirySelectedIds.has(row.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setInquirySelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                  aria-label={`选择 ID ${row.id}`}
                                />
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top">
                                <div className="flex items-start gap-2">
                                  {firstImageUrl && looksLikeImagePath(firstImageUrl) ? (
                                    <a
                                      href={firstImageUrl}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openImageViewer(imageUrls, 0);
                                      }}
                                      title={imageUrls.join("\n")}
                                      className="shrink-0"
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={name}
                                        width={44}
                                        height={44}
                                        className="h-11 w-11 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="h-11 w-11 shrink-0 rounded-lg border border-border bg-surface-2" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="max-w-[180px] truncate font-medium">{name}</div>
                                    <div className="text-xs text-muted">ID：{row.id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {links.length === 0 ? (
                                  <span className="text-muted">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                                    {links.map((u, idx) => (
                                      <a
                                        key={`${u}-${idx}`}
                                        className="text-foreground underline"
                                        href={u}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={u}
                                      >
                                        {links.length > 1 ? `链接${idx + 1}` : "链接"}
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm text-muted">{category}</td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="text-foreground">{productSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：<span className="text-foreground">{pWeight ? `${pWeight}kg` : "—"}</span>
                                  </div>
                                  <div className="text-muted">
                                    规格：<span className="text-foreground">{productSpec || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="text-foreground">{packSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：<span className="text-foreground">{packWeight ? `${packWeight}kg` : "—"}</span>
                                  </div>
                                </div>
                              </td>
                              {inquiryTableExtraFields.map((f) => {
                                const v = obj[f] == null ? "" : String(obj[f]);
                                const kind = getFieldKind(f);
                                const extraImageUrls = kind === "image" ? parseImageUrls(v) : [];
                                const extraFirstImageUrl = extraImageUrls[0] ?? "";
                                return (
                                  <td
                                    key={f}
                                    className={
                                      kind === "image"
                                        ? "border-b border-border px-3 py-2 align-top"
                                        : "max-w-[220px] truncate border-b border-border px-3 py-2 align-top text-muted"
                                    }
                                  >
                                    {kind === "image" && extraFirstImageUrl && looksLikeImagePath(extraFirstImageUrl) ? (
                                      <a
                                        href={extraFirstImageUrl}
                                        className="inline-flex cursor-pointer items-center gap-2 text-foreground"
                                        title={extraImageUrls.join("\n")}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          openImageViewer(extraImageUrls, 0);
                                        }}
                                      >
                                        <Image
                                          src={extraFirstImageUrl}
                                          alt={displayFieldLabel(f)}
                                          width={40}
                                          height={40}
                                          className="h-10 w-10 cursor-pointer rounded-lg border border-border bg-surface-2 object-cover"
                                        />
                                        <span className="cursor-pointer text-xs underline">
                                          {extraImageUrls.length > 1 ? `查看（${extraImageUrls.length}）` : "查看"}
                                        </span>
                                      </a>
                                    ) : kind === "url" ? (
                                      (() => {
                                        const urlList = parseDelimitedValues(v).filter(looksLikeUrl);
                                        if (urlList.length === 0) return v || "—";
                                        return (
                                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                                            {urlList.map((u, idx) => (
                                              <a
                                                key={`${u}-${idx}`}
                                                className="text-foreground underline"
                                                href={u}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={u}
                                              >
                                                {urlList.length > 1 ? `链接${idx + 1}` : "链接"}
                                              </a>
                                            ))}
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      v || "—"
                                    )}
                                  </td>
                                );
                              })}
                              <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right align-top">
                                {!inquiryHistoryMode && (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                      onClick={() => openEdit(row)}
                                    >
                                      修改
                                    </button>
                                    <button
                                      type="button"
                                      className={[
                                        "inline-flex h-8 items-center justify-center gap-1 rounded-lg border bg-surface px-3 text-xs disabled:opacity-50",
                                        canWithdraw ? "border-red-300 text-red-500 hover:bg-red-50" : "border-border text-muted",
                                      ].join(" ")}
                                      onClick={() => openInquiryWithdraw(row)}
                                      disabled={!canWithdraw}
                                      title={canWithdraw ? "撤回" : "仅状态为\u201c待询价\u201d可撤回"}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      撤回
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : workspaceKey === "ops.pricing" ? (
                <div className="overflow-auto">
                  <table className="min-w-max border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-surface-2 text-xs text-muted">
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={
                              pricingFilteredRecords.length > 0 &&
                              pricingFilteredRecords.every((r) => pricingSelectedIds.has(r.id))
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setPricingSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (!checked) {
                                  for (const r of pricingFilteredRecords) next.delete(r.id);
                                  return next;
                                }
                                for (const r of pricingFilteredRecords) next.add(r.id);
                                return next;
                              });
                            }}
                            aria-label="全选"
                          />
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">商品信息</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">参考链接</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">类目</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <span>产品属性</span>
                          <button
                            type="button"
                            className="ml-2 rounded-md bg-surface px-2 py-0.5 text-[10px] text-muted hover:bg-surface-2"
                            onClick={() => setPricingUnits((prev) => (prev === "cmkg" ? "inlb" : "cmkg"))}
                          >
                            {pricingUnits === "cmkg" ? "CM/KG" : "IN/LB"}
                          </button>
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <span>单套属性</span>
                          <button
                            type="button"
                            className="ml-2 rounded-md bg-surface px-2 py-0.5 text-[10px] text-muted hover:bg-surface-2"
                            onClick={() => setPricingUnits((prev) => (prev === "cmkg" ? "inlb" : "cmkg"))}
                          >
                            {pricingUnits === "cmkg" ? "CM/KG" : "IN/LB"}
                          </button>
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">成本总计（RMB）</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">TEUM供货价</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          参考销售售价（MIN，MAX）
                        </th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">选品逻辑</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">自动计算</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">状态</th>
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {pricingFilteredRecords.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-sm text-muted" colSpan={13}>
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        pricingFilteredRecords.map((row) => {
                          const obj = toRecordStringUnknown(row.data);
                          const name = String(obj["名称"] ?? "").trim() || "—";
                          const category = String(obj["所属类目"] ?? "").trim();
                          const imageRaw = String(obj["产品图片"] ?? "");
                          const imageUrls = parseImageUrls(imageRaw);
                          const firstImageUrl = imageUrls[0] ?? "";
                          const links = parseDelimitedValues(String(obj["参考链接"] ?? "")).filter(looksLikeUrl);

                          const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
                          const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
                          const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
                          const pWeight = String(obj["产品重量"] ?? "").trim();
                          const productSpec = String(obj["产品规格"] ?? "").trim();
                          const productSize =
                            pL || pW || pH
                              ? pricingUnits === "cmkg"
                                ? `${pL || "—"}x${pW || "—"}x${pH || "—"}cm`
                                : `${cmToInchesValue(pL) ?? "—"}x${cmToInchesValue(pW) ?? "—"}x${cmToInchesValue(pH) ?? "—"}in`
                              : "—";

                          const packL = String(obj["单套尺寸-长（厘米）"] ?? "").trim();
                          const packW = String(obj["单套尺寸-宽（厘米）"] ?? "").trim();
                          const packH = String(obj["单套尺寸-高（厘米）"] ?? "").trim();
                          const packWeight = String(obj["包裹计费重"] ?? "").trim() || String(obj["包裹实重（公斤）"] ?? "").trim();
                          const packSize =
                            packL || packW || packH
                              ? pricingUnits === "cmkg"
                                ? `${packL || "—"}x${packW || "—"}x${packH || "—"}cm`
                                : `${cmToInchesValue(packL) ?? "—"}x${cmToInchesValue(packW) ?? "—"}x${cmToInchesValue(packH) ?? "—"}in`
                              : "—";

                          const costTotal = String(obj["成本总计"] ?? "").trim();
                          const costPurchase = String(obj["采购成本"] ?? "").trim();
                          const costHead = String(obj["头程成本"] ?? "").trim();
                          const costTail = String(obj["尾程成本（人民币）"] ?? "").trim();
                          const costNegative = String(obj["负向成本"] ?? "").trim();

                          const temuQuote = String(obj["temu报价"] ?? "").trim();
                          const minPrice = String(obj["平台在售价格（Min）"] ?? "").trim();
                          const maxPrice = String(obj["平台在售价格（Max）"] ?? "").trim();
                          const priceMode = String(obj["平台在售价格模式"] ?? "").trim();
                          const priceRange = priceMode === "固定价格" ? (minPrice || "") : (minPrice && maxPrice ? `${minPrice} - ${maxPrice}` : minPrice || maxPrice || "");

                          const logic = String(obj["选品逻辑"] ?? "").trim();
                          const status = String(obj["状态"] ?? "").trim();
                          const busy = pricingRowAction ? pricingRowAction.startsWith(`${row.id}:`) : false;
                          const statusClassName =
                            status === "待核价"
                              ? "bg-orange-50 text-orange-600 border-orange-200"
                              : status === "待分配运营者"
                                ? "bg-blue-50 text-blue-600 border-blue-200"
                                : status === "【核价】已放弃"
                                  ? "bg-red-50 text-red-600 border-red-200"
                                  : "bg-surface-2 text-muted border-border";

                          return (
                            <tr key={row.id} className="border-b border-border">
                              <td className="border-b border-border px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={pricingSelectedIds.has(row.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setPricingSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                  aria-label={`选择 ID ${row.id}`}
                                />
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top">
                                <div className="flex items-start gap-2">
                                  {firstImageUrl && looksLikeImagePath(firstImageUrl) ? (
                                    <a
                                      href={firstImageUrl}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openImageViewer(imageUrls, 0);
                                      }}
                                      title={imageUrls.join("\n")}
                                      className="shrink-0"
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={name}
                                        width={44}
                                        height={44}
                                        className="h-11 w-11 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="h-11 w-11 shrink-0 rounded-lg border border-border bg-surface-2" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="max-w-[180px] truncate font-medium">{name}</div>
                                    <div className="text-xs text-muted">ID：{row.id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                {links.length === 0 ? (
                                  <span className="text-muted">—</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    {links.map((u, idx) => (
                                      <a
                                        key={`${u}-${idx}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-foreground hover:bg-surface-2"
                                        href={u}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={u}
                                        aria-label={links.length > 1 ? `打开链接${idx + 1}` : "打开链接"}
                                      >
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm text-muted">
                                {category || "—"}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="text-foreground">{productSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：
                                    <span className="text-foreground">
                                      {pWeight
                                        ? pricingUnits === "cmkg"
                                          ? `${pWeight}kg`
                                          : `${kgToLbValue(pWeight) ?? "—"}lb`
                                        : "—"}
                                    </span>
                                  </div>
                                  <div className="text-muted">
                                    规格：<span className="text-foreground">{productSpec || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="text-foreground">{packSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：
                                    <span className="text-foreground">
                                      {packWeight
                                        ? pricingUnits === "cmkg"
                                          ? `${packWeight}kg`
                                          : `${kgToLbValue(packWeight) ?? "—"}lb`
                                        : "—"}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm">
                                <div className="flex flex-col gap-2">
                                  <div className="font-medium">{costTotal || "—"}</div>
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
                                    <div>
                                      采购：<span className="text-foreground">{costPurchase || "—"}</span>
                                    </div>
                                    <div>
                                      头程：<span className="text-foreground">{costHead || "—"}</span>
                                    </div>
                                    <div>
                                      尾程：<span className="text-foreground">{costTail || "—"}</span>
                                    </div>
                                    <div>
                                      负向：<span className="text-foreground">{costNegative || "—"}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm text-muted">
                                {temuQuote || "—"}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm text-muted">
                                {priceRange || "—"}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top text-sm text-muted">
                                <div className="max-w-[220px] truncate">{logic || "—"}</div>
                              </td>
                              <td className="max-w-[300px] border-b border-border px-3 py-2 align-top text-xs text-muted">
                                {(() => {
                                  const lines = getPricingComputedSummary(obj);
                                  if (lines.length === 0) return "—";
                                  return (
                                    <div className="space-y-1 whitespace-normal">
                                      {lines.map((line) => (
                                        <div key={line}>{line}</div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="border-b border-border px-3 py-2 align-top">
                                <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", statusClassName].join(" ")}>
                                  {status || "—"}
                                </span>
                              </td>
                              <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right align-top">
                                <div className="flex justify-end gap-2">
                                  {status === "待核价" ? (
                                    <>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                                        onClick={() => updatePricingRowStatus(row.id, "待确品")}
                                        disabled={busy}
                                        aria-label="确品"
                                        title="确品"
                                      >
                                        <Check className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50"
                                        onClick={() => openPricingAbandon(row)}
                                        disabled={busy}
                                        aria-label="放弃"
                                        title="放弃"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-muted hover:bg-surface-2 disabled:opacity-50"
                                        onClick={() => openPricingWithdraw(row)}
                                        disabled={busy}
                                        aria-label="撤回"
                                        title="撤回"
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : status === "已放弃" || status === "【核价】已放弃" ? (
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                                      onClick={() => updatePricingRowStatus(row.id, "待核价")}
                                      disabled={busy}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      撤回
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                                        onClick={() => updatePricingRowStatus(row.id, "待确品")}
                                        disabled={busy}
                                        aria-label="确品"
                                        title="确品"
                                      >
                                        <Check className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50"
                                        onClick={() => openPricingAbandon(row)}
                                        disabled={busy}
                                        aria-label="放弃"
                                        title="放弃"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-muted hover:bg-surface-2 disabled:opacity-50"
                                        onClick={() => openPricingWithdraw(row)}
                                        disabled={busy}
                                        aria-label="撤回"
                                        title="撤回"
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : workspaceKey === "ops.purchase" ? (
                <div className="overflow-auto">
                  <table className="min-w-max border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-surface-2 text-xs text-muted">
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">ID</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">基本信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">SKU信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">产品属性</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">单套属性</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">发货信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">实际单套属性</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">下单数</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">订单总额</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">采购成本</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">发货安排</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">状态</th>
                        <th className="sticky right-0 whitespace-nowrap border-b border-border bg-surface-2 px-4 py-3 text-right">
                          下单操作
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {purchaseFilteredRecords.length === 0 ? (
                        <tr>
                          <td className="px-4 py-10 text-sm text-muted" colSpan={13}>
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        purchaseFilteredRecords.map((row) => {
                          const obj = toRecordStringUnknown(row.data);
                          const id = row.id;

                          const name = String(obj["名称"] ?? "").trim() || "—";
                          const category = String(obj["所属类目"] ?? "").trim();
                          const imageRaw = String(obj["产品图片"] ?? "");
                          const imageUrls = parseImageUrls(imageRaw);
                          const firstImageUrl = imageUrls[0] ?? "";

                          const companyCode = String(obj["公司编码"] ?? "").trim();
                          const warehouseCode = String(obj["仓库编码"] ?? "").trim();
                          const platformCode = String(obj["平台编码"] ?? "").trim();

                          const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
                          const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
                          const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
                          const pWeight = String(obj["产品重量"] ?? "").trim();
                          const productSpec = String(obj["产品规格"] ?? "").trim();
                          const productSize = pL || pW || pH ? `${pL || "—"}x${pW || "—"}x${pH || "—"}cm` : "—";

                          const packL = String(obj["单套尺寸-长（厘米）"] ?? "").trim();
                          const packW = String(obj["单套尺寸-宽（厘米）"] ?? "").trim();
                          const packH = String(obj["单套尺寸-高（厘米）"] ?? "").trim();
                          const packWeight = String(obj["包裹计费重"] ?? "").trim() || String(obj["包裹实重（公斤）"] ?? "").trim();
                          const packSize = packL || packW || packH ? `${packL || "—"}x${packW || "—"}x${packH || "—"}cm` : "—";

                          const planQty = String(obj["计划采购量"] ?? "").trim();
                          const usWarehouse = String(obj["美西仓"] ?? "").trim();
                          const usEastWarehouse = String(obj["美东仓"] ?? "").trim();
                          const szWarehouse = String(obj["深圳仓"] ?? "").trim();

                          const actualPackL = String(obj["外箱尺寸-长（厘米）"] ?? "").trim();
                          const actualPackW = String(obj["外箱尺寸-宽（厘米）"] ?? "").trim();
                          const actualPackH = String(obj["外箱尺寸-高（厘米）"] ?? "").trim();
                          const actualPackWeight = String(obj["外箱实重"] ?? "").trim();
                          const actualPackSize =
                            actualPackL || actualPackW || actualPackH
                              ? `${actualPackL || "—"}x${actualPackW || "—"}x${actualPackH || "—"}cm`
                              : "—x—x—cm";

                          const orderQty = String(obj["下单数"] ?? "").trim();
                          const orderAmount = String(obj["付款明细-订单总金额"] ?? "").trim() || String(obj["订单金额/付款方式"] ?? "").trim();

                          const costPurchase = String(obj["采购成本"] ?? "").trim();
                          const prepay = String(obj["预付"] ?? "").trim();
                          const finalPay = String(obj["尾款"] ?? "").trim();
                          const freight = String(obj["运费"] ?? "").trim();

                          const contractNo = String(obj["阿里订单号"] ?? "").trim();
                          const deliveryDate = String(obj["交期明细-交货日期"] ?? "").trim();
                          const shipPlan = String(obj["发货安排套/箱"] ?? "").trim();

                          const status = String(obj["状态"] ?? "").trim();
                          const busy = purchaseRowAction ? purchaseRowAction.startsWith(`${row.id}:`) : false;

                          const statusDotClassName =
                            status === "待发货"
                              ? "bg-amber-500"
                              : status === "已到仓"
                                ? "bg-emerald-500"
                                : status === "已发运"
                                  ? "bg-purple-500"
                                  : "bg-slate-300";

                          return (
                            <tr key={row.id} className="border-b border-border">
                              <td className="border-b border-border px-4 py-3 align-top text-sm text-muted">
                                ID: {id}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top">
                                <div className="flex items-start gap-2">
                                  {firstImageUrl && looksLikeImagePath(firstImageUrl) ? (
                                    <a
                                      href={firstImageUrl}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openImageViewer(imageUrls, 0);
                                      }}
                                      title={imageUrls.join("\n")}
                                      className="shrink-0"
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={name}
                                        width={44}
                                        height={44}
                                        className="h-11 w-11 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="h-11 w-11 shrink-0 rounded-lg border border-border bg-surface-2" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="max-w-[240px] truncate font-semibold text-foreground">{name}</div>
                                    <div className="mt-1 text-xs text-muted">{category || "—"}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    公司编码：<span className="font-semibold text-primary">{companyCode || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    仓库编码：<span className="font-semibold text-primary">{warehouseCode || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    平台编码：<span className="font-semibold text-primary">{platformCode || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="font-semibold text-primary">{productSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：<span className="font-semibold text-primary">{pWeight ? `${pWeight}kg` : "—"}</span>
                                  </div>
                                  <div className="text-muted">
                                    规格：<span className="font-semibold text-primary">{productSpec || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="font-semibold text-primary">{packSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：<span className="font-semibold text-primary">{packWeight ? `${packWeight}kg` : "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-2">
                                  <div className="rounded-md bg-surface-2 px-3 py-2">
                                    <div className="text-xs text-muted">计划：</div>
                                    <div className="mt-1 text-sm font-semibold text-primary">{planQty || "—"}</div>
                                  </div>
                                  <div className="text-xs text-muted">
                                    {[
                                      usWarehouse ? `美西仓: ${usWarehouse}` : "",
                                      usEastWarehouse ? `美东仓: ${usEastWarehouse}` : "",
                                      szWarehouse ? `深圳仓: ${szWarehouse}` : "",
                                    ]
                                      .filter(Boolean)
                                      .join("，") || "—"}
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="font-semibold text-primary">{actualPackSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：<span className="font-semibold text-primary">{actualPackWeight ? `${actualPackWeight}kg` : "—kg"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    总数：<span className="font-semibold text-foreground">{orderQty || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    剩余/：<span className="text-foreground">{String(obj["剩余未交数量"] ?? "").trim() || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    备注：<span className="text-foreground">{String(obj["其他备注"] ?? "").trim() || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    总额：<span className="font-semibold text-foreground">{orderAmount ? `¥${orderAmount.replace(/^¥/, "")}` : "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    单/箱：<span className="text-foreground">{String(obj["产品单价"] ?? "").trim() || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    预付：<span className={prepay ? "text-emerald-600" : "text-muted"}>{prepay ? "✓" : "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    尾款：<span className={finalPay ? "text-emerald-600" : "text-muted"}>{finalPay ? "✓" : "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    运费：<span className={freight ? "text-emerald-600" : "text-muted"}>{freight ? "✓" : "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    成本：<span className="text-foreground">{costPurchase ? `¥${costPurchase}` : "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    合同：<span className="text-foreground">{contractNo || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    日期：<span className="text-foreground">{deliveryDate || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    计划：<span className="text-foreground">{shipPlan || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${statusDotClassName}`} />
                                  <span className="font-medium text-foreground">{status || "—"}</span>
                                </div>
                              </td>
                              <td className="sticky right-0 whitespace-nowrap border-b border-border bg-surface px-4 py-3 text-right align-top">
                                {!purchaseHistoryMode && (
                                  <div className="flex items-center justify-end gap-2">
                                    <span className="text-xs text-muted">备注</span>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
                                      onClick={() => openEdit(row)}
                                    >
                                      修改
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                                      disabled={busy}
                                      onClick={() => openPurchaseWithdraw(row)}
                                    >
                                      撤回
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : workspaceKey === "ops.confirm" ? (
                <div className="overflow-auto">
                  <table className="min-w-max border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-surface-2 text-xs text-muted">
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">商品基本信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">产品属性</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">单套属性</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">成本总计（RMB）</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">TEUM供货价</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">参考销售售价</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">SKU信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">发货信息</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">销量预估</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">实际下单数</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">订单总数</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">交货周期</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">发货日期</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">发货数量</th>
                        <th className="whitespace-nowrap border-b border-border px-4 py-3 text-left">状态</th>
                        <th className="sticky right-0 whitespace-nowrap border-b border-border bg-surface-2 px-4 py-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {confirmFilteredRecords.length === 0 ? (
                        <tr>
                          <td className="px-4 py-10 text-sm text-muted" colSpan={16}>
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        confirmFilteredRecords.map((row) => {
                          const obj = toRecordStringUnknown(row.data);
                          const name = String(obj["名称"] ?? "").trim() || "—";
                          const category = String(obj["所属类目"] ?? "").trim();
                          const imageRaw = String(obj["产品图片"] ?? "");
                          const imageUrls = parseImageUrls(imageRaw);
                          const firstImageUrl = imageUrls[0] ?? "";
                          const links = parseDelimitedValues(String(obj["参考链接"] ?? "")).filter(looksLikeUrl);

                          const pL = String(obj["产品尺寸-长（厘米）"] ?? "").trim();
                          const pW = String(obj["产品尺寸-宽（厘米）"] ?? "").trim();
                          const pH = String(obj["产品尺寸-高（厘米）"] ?? "").trim();
                          const pWeight = String(obj["产品重量"] ?? "").trim();
                          const productSpec = String(obj["产品规格"] ?? "").trim();
                          const productSize = pL || pW || pH ? `${pL || "—"}x${pW || "—"}x${pH || "—"} cm` : "—";

                          const packL = String(obj["单套尺寸-长（厘米）"] ?? "").trim();
                          const packW = String(obj["单套尺寸-宽（厘米）"] ?? "").trim();
                          const packH = String(obj["单套尺寸-高（厘米）"] ?? "").trim();
                          const packWeight = String(obj["包裹计费重"] ?? "").trim() || String(obj["包裹实重（公斤）"] ?? "").trim();
                          const packSize = packL || packW || packH ? `${packL || "—"}x${packW || "—"}x${packH || "—"} cm` : "—";

                          const costTotal = String(obj["成本总计"] ?? "").trim();
                          const costPurchase = String(obj["采购成本"] ?? "").trim();
                          const costHead = String(obj["头程成本"] ?? "").trim();
                          const costTail = String(obj["尾程成本（人民币）"] ?? "").trim();
                          const costNegative = String(obj["负向成本"] ?? "").trim();

                          const temuQuote = String(obj["temu报价"] ?? "").trim();
                          const minPrice = String(obj["平台在售价格（Min）"] ?? "").trim();
                          const maxPrice = String(obj["平台在售价格（Max）"] ?? "").trim();
                          const priceMode = String(obj["平台在售价格模式"] ?? "").trim();
                          const priceRange = priceMode === "固定价格" ? (minPrice || "") : (minPrice && maxPrice ? `${minPrice} - ${maxPrice}` : minPrice || maxPrice || "");

                          const planQty = String(obj["计划采购量"] ?? "").trim();
                          const usWarehouse = String(obj["美西仓"] ?? "").trim();
                          const usEastWarehouse = String(obj["美东仓"] ?? "").trim();
                          const szWarehouse = String(obj["深圳仓"] ?? "").trim();
                          const forecast = String(obj["预估销量"] ?? "").trim();
                          const forecastSource = String(obj["预估来源"] ?? "").trim();
                          const actualOrder = String(obj["实际下单数"] ?? "").trim();
                          const orderTotal = String(obj["订单总数"] ?? "").trim();
                          const deliveryCycle = String(obj["交货周期"] ?? "").trim();
                          const shipDate = String(obj["发货日期"] ?? "").trim();
                          const shipQty = String(obj["发货数量"] ?? "").trim();
                          const companyCode = String(obj["公司编码"] ?? "").trim();
                          const warehouseCode = String(obj["仓库编码"] ?? "").trim();
                          const platformCode = String(obj["平台编码"] ?? "").trim();

                          const status = String(obj["状态"] ?? "").trim();
                          const busy = confirmRowAction ? confirmRowAction.startsWith(`${row.id}:`) : false;
                          const statusDotClassName =
                            status === "待确品"
                              ? "bg-orange-500"
                              : status === "待采购"
                                ? "bg-blue-500"
                                : status === "已到仓"
                                  ? "bg-emerald-500"
                                  : status === "已放弃"
                                    ? "bg-red-500"
                                    : "bg-slate-300";

                          return (
                            <tr key={row.id} className="border-b border-border">
                              <td className="border-b border-border px-4 py-3 align-top">
                                <div className="flex items-start gap-2">
                                  {firstImageUrl && looksLikeImagePath(firstImageUrl) ? (
                                    <a
                                      href={firstImageUrl}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openImageViewer(imageUrls, 0);
                                      }}
                                      title={imageUrls.join("\n")}
                                      className="shrink-0"
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={name}
                                        width={44}
                                        height={44}
                                        className="h-11 w-11 rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="h-11 w-11 shrink-0 rounded-lg border border-border bg-surface-2" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="max-w-[220px] truncate font-semibold text-foreground">{name}</div>
                                    <div className="mt-1 text-xs text-muted">
                                      ID：{row.id}
                                      {category ? ` ｜ ${category}` : ""}
                                    </div>
                                    {links.length === 0 ? null : (
                                      <div className="mt-2 flex items-center gap-2">
                                        {links.map((u, idx) => (
                                          <a
                                            key={`${u}-${idx}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-foreground hover:bg-surface-2"
                                            href={u}
                                            target="_blank"
                                            rel="noreferrer"
                                            title={u}
                                            aria-label={links.length > 1 ? `打开链接${idx + 1}` : "打开链接"}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="font-medium text-primary">{productSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：
                                    <span className="font-medium text-primary">{pWeight ? `${pWeight} kg` : "—"}</span>
                                  </div>
                                  <div className="text-muted">
                                    规格：<span className="font-medium text-primary">{productSpec || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-muted">
                                    尺寸：<span className="font-medium text-primary">{packSize}</span>
                                  </div>
                                  <div className="text-muted">
                                    重量：
                                    <span className="font-medium text-primary">{packWeight ? `${packWeight} kg` : "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-lg font-semibold text-primary">{costTotal ? `¥${costTotal}` : "—"}</div>
                                  <div className="text-xs text-muted">
                                    {costPurchase ? `采购：¥${costPurchase}` : "采购：—"}
                                  </div>
                                  <div className="text-xs text-muted">{costHead ? `头程：¥${costHead}` : "头程：—"}</div>
                                  <div className="text-xs text-muted">{costTail ? `尾程：¥${costTail}` : "尾程：—"}</div>
                                  <div className="text-xs text-muted">
                                    {costNegative ? `负向：¥${costNegative}` : "负向：—"}
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="text-lg font-semibold text-primary">{temuQuote ? `¥${temuQuote}` : "—"}</div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="text-lg font-semibold text-primary">{priceRange || "—"}</div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    公司编码：<span className="font-semibold text-primary">{companyCode || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    仓库编码：<span className="font-semibold text-primary">{warehouseCode || "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted">
                                    平台编码：<span className="font-semibold text-primary">{platformCode || "—"}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-2">
                                  <div className="rounded-md bg-surface-2 px-3 py-2">
                                    <div className="text-xs text-muted">计划采购量：</div>
                                    <div className="mt-1 text-sm font-semibold text-primary">{planQty || "—"}</div>
                                  </div>
                                  <div className="text-xs text-muted">
                                    {[usWarehouse ? `美西仓：${usWarehouse}` : "", usEastWarehouse ? `美东仓：${usEastWarehouse}` : "", szWarehouse ? `深圳仓：${szWarehouse}` : ""]
                                      .filter(Boolean)
                                      .join("，") || "—"}
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex flex-col gap-1">
                                  <div className="text-lg font-semibold text-primary">{forecast || "—"}</div>
                                  <div className="text-xs text-muted">{forecastSource || "—"}</div>
                                </div>
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm font-semibold text-foreground">
                                {actualOrder || "—"}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm font-semibold text-foreground">
                                {orderTotal || "—"}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm text-foreground">
                                {deliveryCycle || "—"}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm text-foreground">
                                {shipDate || "—"}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm font-semibold text-emerald-600">
                                {shipQty || "—"}
                              </td>
                              <td className="border-b border-border px-4 py-3 align-top text-sm">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${statusDotClassName}`} />
                                  <span className="font-medium text-foreground">{status || "—"}</span>
                                </div>
                              </td>
                              <td className="sticky right-0 whitespace-nowrap border-b border-border bg-surface px-4 py-3 text-right align-top">
                                {!confirmHistoryMode && (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                                      onClick={() => openEdit(row)}
                                    >
                                      修改
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                                      disabled={busy}
                                      onClick={() => openConfirmWithdraw(row)}
                                      aria-label="撤回"
                                      title="撤回"
                                    >
                                      <RotateCcw className="h-4 w-4" />
                                      撤回
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
              <div className="overflow-auto">
                <table className="min-w-max border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-surface-2 text-xs text-muted">
                      {workspaceKey === "ops.inquiry" ? (
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={records.length > 0 && records.every((r) => inquirySelectedIds.has(r.id))}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setInquirySelectedIds(() => {
                                if (!checked) return new Set();
                                const next = new Set<number>();
                                for (const r of records) next.add(r.id);
                                return next;
                              });
                            }}
                            aria-label="全选"
                          />
                        </th>
                      ) : workspaceKey === "ops.pricing" ? (
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={records.length > 0 && records.every((r) => pricingSelectedIds.has(r.id))}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setPricingSelectedIds(() => {
                                if (!checked) return new Set();
                                const next = new Set<number>();
                                for (const r of records) next.add(r.id);
                                return next;
                              });
                            }}
                            aria-label="全选"
                          />
                        </th>
                      ) : null}
                      {tableFields.map((f) => (
                        <th key={f} className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                          {displayFieldLabel(f)}
                        </th>
                      ))}
                      {workspaceKey === "ops.pricing" ? (
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">自动计算</th>
                      ) : null}
                      {workspaceKey === "ops.inquiry" ? (
                        <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left">成本总计（RMB）</th>
                      ) : null}
                      <th className="whitespace-nowrap border-b border-border px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {records.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-6 text-sm text-muted"
                          colSpan={
                            tableFields.length +
                            1 +
                            (workspaceKey === "ops.inquiry" || workspaceKey === "ops.pricing" ? 1 : 0) +
                            (workspaceKey === "ops.pricing" || workspaceKey === "ops.inquiry" ? 1 : 0)
                          }
                        >
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      records.map((row) => {
                        const obj = toRecordStringUnknown(row.data);
                        const status = String(obj["状态"] ?? "").trim();
                        const operator = String(obj["运营人员"] ?? "").trim();
                        const pricingBusy = pricingRowAction ? pricingRowAction.startsWith(`${row.id}:`) : false;
                        return (
                          <tr key={row.id} className="border-b border-border">
                            {workspaceKey === "ops.inquiry" ? (
                              <td className="border-b border-border px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={inquirySelectedIds.has(row.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setInquirySelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                  aria-label={`选择 ID ${row.id}`}
                                />
                              </td>
                            ) : workspaceKey === "ops.pricing" ? (
                              <td className="border-b border-border px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={pricingSelectedIds.has(row.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setPricingSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                  aria-label={`选择 ID ${row.id}`}
                                />
                              </td>
                            ) : null}
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
                                      className="inline-flex cursor-pointer items-center gap-2 text-foreground"
                                      title={imageUrls.join("\n")}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openImageViewer(imageUrls, 0);
                                      }}
                                    >
                                      <Image
                                        src={firstImageUrl}
                                        alt={displayFieldLabel(f)}
                                        width={40}
                                        height={40}
                                        className="h-10 w-10 cursor-pointer rounded-lg border border-border bg-surface-2 object-cover"
                                      />
                                      <span className="cursor-pointer text-xs underline">
                                        {imageUrls.length > 1 ? `查看（${imageUrls.length}）` : "查看"}
                                      </span>
                                    </a>
                                  ) : kind === "url" ? (
                                    (() => {
                                      const urlList = parseDelimitedValues(v).filter(looksLikeUrl);
                                      if (urlList.length === 0) return v || "—";
                                      return (
                                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                                          {urlList.map((u, idx) => (
                                            <a
                                              key={`${u}-${idx}`}
                                              className="text-foreground underline"
                                              href={u}
                                              target="_blank"
                                              rel="noreferrer"
                                              title={u}
                                            >
                                              {urlList.length > 1 ? `链接${idx + 1}` : "链接"}
                                            </a>
                                          ))}
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    v || "—"
                                  )}
                                </td>
                              );
                            })}
                            {workspaceKey === "ops.pricing" ? (
                              <td className="max-w-[300px] border-b border-border px-3 py-2 text-xs text-muted">
                                {(() => {
                                  const lines = getPricingComputedSummary(obj);
                                  if (lines.length === 0) return "—";
                                  return (
                                    <div className="space-y-1 whitespace-normal">
                                      {lines.map((line) => (
                                        <div key={line}>{line}</div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                            ) : null}
                            {workspaceKey === "ops.inquiry" ? (
                              <td className="max-w-[260px] border-b border-border px-3 py-2 text-xs text-muted">
                                {(() => {
                                  const lines = getInquiryCostSummary(obj);
                                  if (lines.length === 0) return "—";
                                  return (
                                    <div className="space-y-1 whitespace-normal">
                                      {lines.map((line) => (
                                        <div key={line}>{line}</div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                            ) : null}
                            <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right">
                              {!(workspaceKey === "ops.pricing" && pricingHistoryMode) && (
                              <div className="flex justify-end gap-2">
                                {workspaceKey === "ops.pricing" && (status === "待分配运营者" || !operator) ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2 disabled:opacity-50"
                                    onClick={() => openPricingAssign(row)}
                                    disabled={pricingBulkAssignSaving || pricingAssigneeLoading}
                                  >
                                    分配运营者
                                  </button>
                                ) : null}
                                {workspaceKey === "ops.pricing" && status === "待核价" ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-surface px-3 text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                                    onClick={() => updatePricingRowStatus(row.id, "待确品")}
                                    disabled={pricingBusy}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    通过
                                  </button>
                                ) : null}
                                {workspaceKey === "ops.pricing" && status !== "已放弃" && status !== "【核价】已放弃" ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-red-300 bg-surface px-3 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                                    onClick={() => openPricingAbandon(row)}
                                    disabled={pricingBusy}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    放弃
                                  </button>
                                ) : null}
                                {workspaceKey === "ops.pricing" ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                                    onClick={() => openPricingWithdraw(row)}
                                    disabled={pricingBusy}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    撤回
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => openEdit(row)}
                                  disabled={
                                    (workspaceKey === "ops.inquiry" && !canEditInquiryRow(row)) ||
                                    (workspaceKey === "ops.pricing" && !canEditPricingRow(row))
                                  }
                                  title={
                                    workspaceKey === "ops.inquiry" && !canEditInquiryRow(row)
                                      ? "仅被分配的询价人可修改"
                                      : workspaceKey === "ops.pricing" && !canEditPricingRow(row)
                                        ? "请先分配运营者后再修改"
                                        : undefined
                                  }
                                >
                                  修改
                                </button>
                                {workspaceKey === "ops.inquiry" ? (
                                  <button
                                    type="button"
                                    className={[
                                      "inline-flex h-8 items-center justify-center gap-1 rounded-lg border bg-surface px-3 text-xs disabled:opacity-50",
                                      status === "待询价"
                                        ? "border-red-300 text-red-500 hover:bg-red-50"
                                        : "border-border text-muted",
                                    ].join(" ")}
                                    onClick={() => openInquiryWithdraw(row)}
                                    disabled={status !== "待询价"}
                                    title={status === "待询价" ? "撤回" : "仅状态为“待询价”可撤回"}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    撤回
                                  </button>
                                ) : null}
                              </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )) : (
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
                          {workspaceKey === "ops.inquiry" ? (
                            (() => {
                              const obj = toRecordStringUnknown(row.data);
                              const canWithdraw = String(obj["状态"] ?? "").trim() === "待询价";
                              return (
                            <button
                              type="button"
                              className={[
                                "ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-surface disabled:opacity-50",
                                canWithdraw ? "border-red-300 text-red-500 hover:bg-red-50" : "border-border text-muted",
                              ].join(" ")}
                              title={canWithdraw ? "撤回" : "仅状态为“待询价”可撤回"}
                              onClick={() => openInquiryWithdraw(row)}
                              disabled={!canWithdraw}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                              );
                            })()
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

      {imageViewer ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-5xl rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{`图片预览（${imageViewer.index + 1}/${imageViewer.urls.length}）`}</div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                title="关闭"
                onClick={closeImageViewer}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 disabled:opacity-50"
                disabled={imageViewer.index <= 0}
                onClick={() =>
                  setImageViewer((prev) => (prev ? { ...prev, index: Math.max(0, prev.index - 1) } : prev))
                }
                aria-label="上一张"
              >
                ‹
              </button>

              <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface-2">
                <div className="flex h-[60vh] items-center justify-center">
                  <Image
                    src={imageViewer.urls[imageViewer.index] ?? ""}
                    alt="图片预览"
                    width={1400}
                    height={900}
                    className="h-[60vh] w-full object-contain"
                  />
                </div>
              </div>

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 disabled:opacity-50"
                disabled={imageViewer.index >= imageViewer.urls.length - 1}
                onClick={() =>
                  setImageViewer((prev) =>
                    prev ? { ...prev, index: Math.min(prev.urls.length - 1, prev.index + 1) } : prev,
                  )
                }
                aria-label="下一张"
              >
                ›
              </button>
            </div>

            {imageViewer.urls.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {imageViewer.urls.map((u, idx) => (
                  <button
                    key={`${u}-${idx}`}
                    type="button"
                    className={[
                      "overflow-hidden rounded-lg border bg-surface p-0",
                      idx === imageViewer.index ? "border-primary" : "border-border hover:bg-surface-2",
                    ].join(" ")}
                    onClick={() => setImageViewer((prev) => (prev ? { ...prev, index: idx } : prev))}
                    aria-label={`查看第 ${idx + 1} 张`}
                  >
                    <Image src={u} alt={`缩略图 ${idx + 1}`} width={64} height={64} className="h-16 w-16 object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {inquiryCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-6">
          <div className="my-auto w-full max-w-3xl max-h-[calc(100vh-3rem)] overflow-y-auto rounded-xl border border-border bg-surface p-4">
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
                        readOnly
                        className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">所属类目</div>
                      <input
                        list="inquiry-category-options"
                        value={inquiryForm.category}
                        readOnly
                        className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                        placeholder="—"
                      />
                      <datalist id="inquiry-category-options">
                        {categories.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <div className="text-xs text-muted">产品图片</div>
                      {(() => {
                        const urls = parseImageUrls(inquiryForm.productImages);
                        const first = urls[0] ?? "";
                        if (!first || !looksLikeImagePath(first)) {
                          return (
                            <div className="flex h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm text-muted opacity-70">
                              —
                            </div>
                          );
                        }
                        return (
                          <button
                            type="button"
                            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-2"
                            onClick={() => openImageViewer(urls, 0)}
                          >
                            <Image
                              src={first}
                              alt="产品图片"
                              width={32}
                              height={32}
                              className="h-8 w-8 cursor-pointer rounded border border-border bg-surface-2 object-cover"
                            />
                            <span className="cursor-pointer text-xs underline">
                              {urls.length > 1 ? `查看（${urls.length}）` : "查看"}
                            </span>
                          </button>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <div className="text-xs text-muted">参考链接</div>
                      {(() => {
                        const urlList = parseDelimitedValues(inquiryForm.referenceLinks).filter(looksLikeUrl);
                        if (urlList.length === 0) {
                          return (
                            <div className="flex h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm text-muted opacity-70">
                              —
                            </div>
                          );
                        }
                        return (
                          <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                            {urlList.map((u, idx) => (
                              <a
                                key={`${u}-${idx}`}
                                className="text-foreground underline"
                                href={u}
                                target="_blank"
                                rel="noreferrer"
                                title={u}
                              >
                                {urlList.length > 1 ? `链接${idx + 1}` : "链接"}
                              </a>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">产品属性</div>
                      <span className="inline-flex h-5 items-center rounded-md border border-border px-2 text-[10px] text-muted">
                        尺寸/重量
                      </span>
                    </div>
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
                      <div className="text-xs text-muted">产品尺寸（长 / 宽 / 高，{inquiryUnits === "cmkg" ? "cm" : "in"}）</div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageLengthCm
                              : (cmToInchesValue(inquiryForm.packageLengthCm) ?? "")
                          }
                          onChange={(e) => {
                            pendingInquiryModalFocus.current = {
                              key: "inquiry-create-package-length",
                              selectionStart: e.currentTarget.selectionStart,
                              selectionEnd: e.currentTarget.selectionEnd,
                            };
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
                          onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); }}
                          onWheel={(e) => e.currentTarget.blur()}
                          ref={(el) => {
                            inquiryModalFieldRefs.current["inquiry-create-package-length"] = el;
                          }}
                          placeholder="长"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageWidthCm
                              : (cmToInchesValue(inquiryForm.packageWidthCm) ?? "")
                          }
                          onChange={(e) => {
                            pendingInquiryModalFocus.current = {
                              key: "inquiry-create-package-width",
                              selectionStart: e.currentTarget.selectionStart,
                              selectionEnd: e.currentTarget.selectionEnd,
                            };
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
                          onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); }}
                          onWheel={(e) => e.currentTarget.blur()}
                          ref={(el) => {
                            inquiryModalFieldRefs.current["inquiry-create-package-width"] = el;
                          }}
                          placeholder="宽"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={
                            inquiryUnits === "cmkg"
                              ? inquiryForm.packageHeightCm
                              : (cmToInchesValue(inquiryForm.packageHeightCm) ?? "")
                          }
                          onChange={(e) => {
                            pendingInquiryModalFocus.current = {
                              key: "inquiry-create-package-height",
                              selectionStart: e.currentTarget.selectionStart,
                              selectionEnd: e.currentTarget.selectionEnd,
                            };
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
                          onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); }}
                          onWheel={(e) => e.currentTarget.blur()}
                          ref={(el) => {
                            inquiryModalFieldRefs.current["inquiry-create-package-height"] = el;
                          }}
                          placeholder="高"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">产品重量（{inquiryUnits === "cmkg" ? "kg" : "lb"}）</div>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={
                          inquiryUnits === "cmkg"
                            ? inquiryForm.packageWeightKg
                            : (kgToLbValue(inquiryForm.packageWeightKg) ?? "")
                        }
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-create-package-weight",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
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
                        onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); }}
                        onWheel={(e) => e.currentTarget.blur()}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-create-package-weight"] = el;
                        }}
                        placeholder="请输入重量"
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">产品规格</div>
                      <input
                        value={inquiryForm.productSpec}
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-create-product-spec",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
                          setInquiryForm((prev) => ({ ...prev, productSpec: e.target.value }));
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-create-product-spec"] = el;
                        }}
                        placeholder="请输入产品规格"
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
                      onChange={(e) => {
                        pendingInquiryModalFocus.current = {
                          key: "inquiry-create-unit-price",
                          selectionStart: e.currentTarget.selectionStart,
                          selectionEnd: e.currentTarget.selectionEnd,
                        };
                        setInquiryForm((prev) => ({ ...prev, productUnitPrice: e.target.value }));
                      }}
                      ref={(el) => {
                        inquiryModalFieldRefs.current["inquiry-create-unit-price"] = el;
                      }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">起订量</div>
                      <input
                        inputMode="numeric"
                        value={inquiryForm.moq}
                      onChange={(e) => {
                        pendingInquiryModalFocus.current = {
                          key: "inquiry-create-moq",
                          selectionStart: e.currentTarget.selectionStart,
                          selectionEnd: e.currentTarget.selectionEnd,
                        };
                        setInquiryForm((prev) => ({ ...prev, moq: e.target.value }));
                      }}
                      ref={(el) => {
                        inquiryModalFieldRefs.current["inquiry-create-moq"] = el;
                      }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">优惠政策</div>
                      <select
                        value={inquiryForm.discountPolicy}
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-create-discount-policy",
                            selectionStart: null,
                            selectionEnd: null,
                          };
                          const next = (e.target.value as "" | "有" | "无") || "";
                          setInquiryForm((prev) => ({
                            ...prev,
                            discountPolicy: next,
                            discountNote: next === "有" ? prev.discountNote : "",
                          }));
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-create-discount-policy"] = el;
                        }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      >
                        <option value="">请选择</option>
                        <option value="有">有</option>
                        <option value="无">无</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">交货周期</div>
                      <input
                        value={inquiryForm.deliveryCycle}
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-create-delivery-cycle",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
                          setInquiryForm((prev) => ({ ...prev, deliveryCycle: e.target.value }));
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-create-delivery-cycle"] = el;
                        }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    {inquiryForm.discountPolicy === "有" ? (
                      <div className="flex flex-col gap-1 sm:col-span-2">
                        <div className="text-xs text-muted">优惠备注</div>
                        <textarea
                          value={inquiryForm.discountNote}
                          onChange={(e) => {
                            pendingInquiryModalFocus.current = {
                              key: "inquiry-create-discount-note",
                              selectionStart: e.currentTarget.selectionStart,
                              selectionEnd: e.currentTarget.selectionEnd,
                            };
                            setInquiryForm((prev) => ({ ...prev, discountNote: e.target.value }));
                          }}
                          ref={(el) => {
                            inquiryModalFieldRefs.current["inquiry-create-discount-note"] = el;
                          }}
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
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-create-main-process",
                            selectionStart: null,
                            selectionEnd: null,
                          };
                          setInquiryForm((prev) => ({ ...prev, mainProcess: e.target.value }));
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-create-main-process"] = el;
                        }}
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
                      onChange={(e) => {
                        pendingInquiryModalFocus.current = {
                          key: "inquiry-create-factory-location",
                          selectionStart: e.currentTarget.selectionStart,
                          selectionEnd: e.currentTarget.selectionEnd,
                        };
                        setInquiryForm((prev) => ({ ...prev, factoryLocation: e.target.value }));
                      }}
                      ref={(el) => {
                        inquiryModalFieldRefs.current["inquiry-create-factory-location"] = el;
                      }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">联系人</div>
                      <input
                        value={inquiryForm.factoryContact}
                      onChange={(e) => {
                        pendingInquiryModalFocus.current = {
                          key: "inquiry-create-factory-contact",
                          selectionStart: e.currentTarget.selectionStart,
                          selectionEnd: e.currentTarget.selectionEnd,
                        };
                        setInquiryForm((prev) => ({ ...prev, factoryContact: e.target.value }));
                      }}
                      ref={(el) => {
                        inquiryModalFieldRefs.current["inquiry-create-factory-contact"] = el;
                      }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted">联系人电话</div>
                      <input
                        value={inquiryForm.factoryPhone}
                      onChange={(e) => {
                        pendingInquiryModalFocus.current = {
                          key: "inquiry-create-factory-phone",
                          selectionStart: e.currentTarget.selectionStart,
                          selectionEnd: e.currentTarget.selectionEnd,
                        };
                        setInquiryForm((prev) => ({ ...prev, factoryPhone: e.target.value }));
                      }}
                      ref={(el) => {
                        inquiryModalFieldRefs.current["inquiry-create-factory-phone"] = el;
                      }}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-surface p-3">
              <div className="text-sm font-medium">成本信息</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted">采购成本</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={inquiryForm.purchaseCost}
                    onChange={(e) => setInquiryForm((prev) => ({ ...prev, purchaseCost: e.target.value }))}
                    placeholder="请输入采购成本"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                  />
                </div>
                <div>
                  <div className="text-xs text-muted">美元汇率</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={inquiryForm.usdRate}
                    onChange={(e) => setInquiryForm((prev) => ({ ...prev, usdRate: e.target.value }))}
                    placeholder="请输入美元汇率"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                  />
                </div>
              </div>
            </div>

            {inquiryComputedPreview.length > 0 ? (
              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">自动计算结果（保存/提交后）</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {inquiryComputedPreview.map((item) => (
                    <div key={item.field} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <div className="text-xs text-muted">{item.field}</div>
                      <div className="mt-1 text-sm">{item.value || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
                onClick={() => saveInquiryPurchase("待询价", "save")}
                disabled={inquiryActionLoading != null}
              >
                {inquiryActionLoading === "save" ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                onClick={() => saveInquiryPurchase("待分配运营者", "submit")}
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
                    <div className="text-xs text-muted">单套尺寸（长 / 宽 / 高，{inquiryAssignUnits === "cmkg" ? "cm" : "in"}）</div>
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

      {inquiryWithdrawOpen ? (
        <EditModalShell
          title={inquiryWithdrawRecordId != null ? `撤回询价（ID: ${inquiryWithdrawRecordId}）` : "撤回询价"}
          dataEditModal="inquiry-withdraw"
          onClose={() => {
            setInquiryWithdrawOpen(false);
            setInquiryWithdrawRecordId(null);
            setInquiryWithdrawPreview(null);
            setInquiryWithdrawReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写撤回理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">基本信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={inquiryWithdrawPreview?.productName ?? "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <input
                      value={inquiryWithdrawPreview?.category ?? "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">产品属性</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">尺寸（长x宽x高）</div>
                    <input
                      value={inquiryWithdrawPreview?.productSize ?? "—x—x—cm"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">重量</div>
                    <input
                      value={inquiryWithdrawPreview?.productWeight ?? "—kg"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">撤回理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={inquiryWithdrawReason}
                    onChange={(e) => setInquiryWithdrawReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入撤回理由，例如：供应商报价过高、产品规格不符等..."
                    disabled={inquiryWithdrawSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setInquiryWithdrawOpen(false);
                setInquiryWithdrawRecordId(null);
                setInquiryWithdrawPreview(null);
                setInquiryWithdrawReason("");
              }}
              disabled={inquiryWithdrawSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={saveInquiryWithdraw}
              disabled={inquiryWithdrawSaving || !inquiryWithdrawReason.trim()}
            >
              {inquiryWithdrawSaving ? "提交中…" : "确定撤回"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {pricingAbandonOpen ? (
        <EditModalShell
          title={pricingAbandonRecordId != null ? `放弃核价（ID: ${pricingAbandonRecordId}）` : "放弃核价"}
          dataEditModal="pricing-abandon"
          onClose={() => {
            setPricingAbandonOpen(false);
            setPricingAbandonRecordId(null);
            setPricingAbandonProductName("");
            setPricingAbandonReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写放弃理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">商品信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={pricingAbandonProductName || "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">放弃理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={pricingAbandonReason}
                    onChange={(e) => setPricingAbandonReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入放弃理由，例如：成本过高、供应链无法满足等..."
                    disabled={pricingAbandonSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setPricingAbandonOpen(false);
                setPricingAbandonRecordId(null);
                setPricingAbandonProductName("");
                setPricingAbandonReason("");
              }}
              disabled={pricingAbandonSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={savePricingAbandon}
              disabled={pricingAbandonSaving || !pricingAbandonReason.trim()}
            >
              {pricingAbandonSaving ? "提交中…" : "确定放弃"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {pricingWithdrawOpen ? (
        <EditModalShell
          title={pricingWithdrawRecordId != null ? `撤回核价（ID: ${pricingWithdrawRecordId}）` : "撤回核价"}
          dataEditModal="pricing-withdraw"
          onClose={() => {
            setPricingWithdrawOpen(false);
            setPricingWithdrawRecordId(null);
            setPricingWithdrawProductName("");
            setPricingWithdrawReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写撤回理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">商品信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={pricingWithdrawProductName || "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">撤回理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={pricingWithdrawReason}
                    onChange={(e) => setPricingWithdrawReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入撤回理由，例如：资料不完整、需重新询价等..."
                    disabled={pricingWithdrawSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setPricingWithdrawOpen(false);
                setPricingWithdrawRecordId(null);
                setPricingWithdrawProductName("");
                setPricingWithdrawReason("");
              }}
              disabled={pricingWithdrawSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={savePricingWithdraw}
              disabled={pricingWithdrawSaving || !pricingWithdrawReason.trim()}
            >
              {pricingWithdrawSaving ? "提交中…" : "确认撤回"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {confirmWithdrawOpen ? (
        <EditModalShell
          title={confirmWithdrawRecordId != null ? `撤回确品（ID: ${confirmWithdrawRecordId}）` : "撤回确品"}
          dataEditModal="confirm-withdraw"
          onClose={() => {
            setConfirmWithdrawOpen(false);
            setConfirmWithdrawRecordId(null);
            setConfirmWithdrawProductName("");
            setConfirmWithdrawReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写撤回理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">商品信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={confirmWithdrawProductName || "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">撤回理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={confirmWithdrawReason}
                    onChange={(e) => setConfirmWithdrawReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入撤回理由，例如：资料不完整、需重新核价等..."
                    disabled={confirmWithdrawSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setConfirmWithdrawOpen(false);
                setConfirmWithdrawRecordId(null);
                setConfirmWithdrawProductName("");
                setConfirmWithdrawReason("");
              }}
              disabled={confirmWithdrawSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={saveConfirmWithdraw}
              disabled={confirmWithdrawSaving || !confirmWithdrawReason.trim()}
            >
              {confirmWithdrawSaving ? "提交中…" : "确认撤回"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {purchaseWithdrawOpen ? (
        <EditModalShell
          title={purchaseWithdrawRecordId != null ? `撤回采购（ID: ${purchaseWithdrawRecordId}）` : "撤回采购"}
          dataEditModal="purchase-withdraw"
          onClose={() => {
            setPurchaseWithdrawOpen(false);
            setPurchaseWithdrawRecordId(null);
            setPurchaseWithdrawProductName("");
            setPurchaseWithdrawReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写撤回理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">商品信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={purchaseWithdrawProductName || "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">撤回理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={purchaseWithdrawReason}
                    onChange={(e) => setPurchaseWithdrawReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入撤回理由，例如：需重新确品、信息有误等..."
                    disabled={purchaseWithdrawSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setPurchaseWithdrawOpen(false);
                setPurchaseWithdrawRecordId(null);
                setPurchaseWithdrawProductName("");
                setPurchaseWithdrawReason("");
              }}
              disabled={purchaseWithdrawSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={savePurchaseWithdraw}
              disabled={purchaseWithdrawSaving || !purchaseWithdrawReason.trim()}
            >
              {purchaseWithdrawSaving ? "提交中…" : "确认撤回"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {selectionAbandonOpen ? (
        <EditModalShell
          title={selectionAbandonRecordId != null ? `放弃选品（ID: ${selectionAbandonRecordId}）` : "放弃选品"}
          dataEditModal="selection-abandon"
          onClose={() => {
            setSelectionAbandonOpen(false);
            setSelectionAbandonRecordId(null);
            setSelectionAbandonPreview(null);
            setSelectionAbandonReason("");
          }}
        >
          <div className="mt-1 text-sm text-muted">请确认商品信息并填写放弃理由</div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">基本信息</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={selectionAbandonPreview?.productName ?? "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <input
                      value={selectionAbandonPreview?.category ?? "—"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">产品属性</div>
                  <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">尺寸（长x宽x高）</div>
                    <input
                      value={selectionAbandonPreview?.productSize ?? "—x—x—cm"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">重量</div>
                    <input
                      value={selectionAbandonPreview?.productWeight ?? "—kg"}
                      readOnly
                      disabled
                      className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">放弃理由</div>
                  <span className="text-sm font-medium text-red-500">*</span>
                </div>
                <div className="mt-4">
                  <textarea
                    value={selectionAbandonReason}
                    onChange={(e) => setSelectionAbandonReason(e.target.value)}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                    placeholder="请输入放弃理由，例如：供应商报价过高、产品规格不符等..."
                    disabled={selectionAbandonSaving}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setSelectionAbandonOpen(false);
                setSelectionAbandonRecordId(null);
                setSelectionAbandonPreview(null);
                setSelectionAbandonReason("");
              }}
              disabled={selectionAbandonSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-surface px-4 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
              onClick={saveSelectionAbandon}
              disabled={selectionAbandonSaving || !selectionAbandonReason.trim()}
            >
              {selectionAbandonSaving ? "提交中…" : "确定放弃"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {inquiryBulkAssignOpen ? (
        <EditModalShell
          title={`批量分配询价人（${inquirySelectedIds.size}条）`}
          dataEditModal="inquiry-bulk-assign"
          onClose={() => {
            setInquiryBulkAssignOpen(false);
            setInquiryBulkAssignPerson("");
          }}
        >
          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">已选择记录</div>
                <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
                  {(() => {
                    const selected = records.filter((r) => inquirySelectedIds.has(r.id));
                    if (selected.length === 0) return <div className="py-1">暂无选择</div>;
                    return (
                      <ul className="list-disc pl-5">
                        {selected.map((r) => {
                          const obj = toRecordStringUnknown(r.data);
                          const name = String(obj["名称"] ?? "").trim();
                          const cat = String(obj["所属类目"] ?? "").trim();
                          return (
                            <li key={r.id} className="py-1">
                              <span>ID：{r.id}</span>
                              {name ? <span>，名称：{name}</span> : null}
                              {cat ? <span>，所属类目：{cat}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-muted">选择询价人</div>
                  <select
                    value={inquiryBulkAssignPerson}
                    onChange={(e) => setInquiryBulkAssignPerson(e.target.value)}
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
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setInquiryBulkAssignOpen(false);
                setInquiryBulkAssignPerson("");
              }}
              disabled={inquiryBulkAssignSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
              onClick={saveInquiryBulkAssign}
              disabled={inquiryBulkAssignSaving || inquiryAssigneeLoading || !inquiryBulkAssignPerson.trim()}
            >
              {inquiryBulkAssignSaving ? "提交中…" : "确认分配"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {pricingBulkAssignOpen ? (
        <EditModalShell
          title={`批量分配运营者（${pricingSelectedIds.size}条）`}
          dataEditModal="pricing-bulk-assign"
          onClose={() => {
            setPricingBulkAssignOpen(false);
            setPricingBulkAssignPerson("");
          }}
        >
          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">已选择记录</div>
                <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
                  {(() => {
                    const selected = records.filter((r) => pricingSelectedIds.has(r.id));
                    if (selected.length === 0) return <div className="py-1">暂无选择</div>;
                    return (
                      <ul className="list-disc pl-5">
                        {selected.map((r) => {
                          const obj = toRecordStringUnknown(r.data);
                          const name = String(obj["名称"] ?? "").trim();
                          const cat = String(obj["所属类目"] ?? "").trim();
                          const operator = String(obj["运营人员"] ?? "").trim();
                          return (
                            <li key={r.id} className="py-1">
                              <span>ID：{r.id}</span>
                              {name ? <span>，名称：{name}</span> : null}
                              {cat ? <span>，所属类目：{cat}</span> : null}
                              {operator ? <span>，当前运营者：{operator}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-muted">选择运营者</div>
                  <select
                    value={pricingBulkAssignPerson}
                    onChange={(e) => setPricingBulkAssignPerson(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    disabled={pricingAssigneeLoading}
                  >
                    <option value="">请选择</option>
                    {pricingAssigneeOptions.map((u) => (
                      <option key={u.username} value={u.username}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              onClick={() => {
                setPricingBulkAssignOpen(false);
                setPricingBulkAssignPerson("");
              }}
              disabled={pricingBulkAssignSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
              onClick={savePricingBulkAssign}
              disabled={pricingBulkAssignSaving || pricingAssigneeLoading || !pricingBulkAssignPerson.trim()}
            >
              {pricingBulkAssignSaving ? "提交中…" : "确认分配"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {inquiryBulkEditOpen ? (
        <EditModalShell
          title={`批量修改数据（${(inquiryBulkEditIds.length || inquirySelectedIds.size).toString()}条）`}
          dataEditModal="inquiry-bulk-edit"
          onClose={() => {
            setInquiryBulkEditOpen(false);
            setInquiryBulkEditAction(null);
            setInquiryBulkEditPreview(null);
            setInquiryBulkEditIds([]);
            setInquiryBulkEditSpecs([]);
            setInquiryBulkEditForm({
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
          }}
        >
          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">已选择记录</div>
                <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
                  {(() => {
                    const selected = records.filter((r) => inquirySelectedIds.has(r.id));
                    if (selected.length === 0) return <div className="py-1">暂无选择</div>;
                    return (
                      <ul className="list-disc pl-5">
                        {selected.map((r) => {
                          const obj = toRecordStringUnknown(r.data);
                          const name = String(obj["名称"] ?? "").trim();
                          const cat = String(obj["所属类目"] ?? "").trim();
                          return (
                            <li key={r.id} className="py-1">
                              <span>ID：{r.id}</span>
                              {name ? <span>，名称：{name}</span> : null}
                              {cat ? <span>，所属类目：{cat}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
                <div className="mt-2 text-xs text-muted">留空表示不修改</div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">基本信息</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">商品名称</div>
                    <input
                      value={inquiryBulkEditPreview?.productName || "—"}
                      readOnly
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">所属类目</div>
                    <input
                      value={inquiryBulkEditPreview?.category || "—"}
                      readOnly
                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <div className="text-xs text-muted">产品规格</div>
                    {inquiryBulkEditSpecs.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {inquiryBulkEditSpecs.map((it, idx) => (
                          <input
                            key={`${it}-${idx}`}
                            value={it}
                            readOnly
                            className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm text-muted opacity-70">
                        —
                      </div>
                    )}
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
                        inquiryBulkEditUnits === "cmkg"
                          ? "border-primary bg-surface text-primary"
                          : "border-border bg-surface hover:bg-surface-2 text-muted",
                      ].join(" ")}
                      onClick={() => setInquiryBulkEditUnits("cmkg")}
                    >
                      cm/kg
                    </button>
                    <button
                      type="button"
                      className={[
                        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs",
                        inquiryBulkEditUnits === "inlb"
                          ? "border-primary bg-surface text-primary"
                          : "border-border bg-surface hover:bg-surface-2 text-muted",
                      ].join(" ")}
                      onClick={() => setInquiryBulkEditUnits("inlb")}
                    >
                      英寸/英镑
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">单套尺寸（长 / 宽 / 高，{inquiryBulkEditUnits === "cmkg" ? "cm" : "in"}）</div>
                    <div className="flex gap-2">
                      <input
                        inputMode="decimal"
                        value={
                          inquiryBulkEditUnits === "cmkg"
                            ? inquiryBulkEditForm.packageLengthCm
                            : (cmToInchesValue(inquiryBulkEditForm.packageLengthCm) ?? "")
                        }
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-bulk-package-length",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
                          const next = e.target.value;
                          setInquiryBulkEditForm((prev) => {
                            if (inquiryBulkEditUnits === "cmkg") return { ...prev, packageLengthCm: next };
                            const t = next.trim();
                            if (!t) return { ...prev, packageLengthCm: "" };
                            const cm = inchesToCmValue(next);
                            if (cm == null) return prev;
                            return { ...prev, packageLengthCm: cm };
                          });
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-bulk-package-length"] = el;
                        }}
                        placeholder={(() => {
                          const v = inquiryBulkEditPreview?.packageLengthCm ?? "";
                          if (!v) return "留空不修改";
                          if (v.startsWith("（")) return `当前：${v}`;
                          if (inquiryBulkEditUnits === "cmkg") return `当前：${v}`;
                          const inch = cmToInchesValue(v);
                          return `当前：${inch ?? v}`;
                        })()}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                      <input
                        inputMode="decimal"
                        value={
                          inquiryBulkEditUnits === "cmkg"
                            ? inquiryBulkEditForm.packageWidthCm
                            : (cmToInchesValue(inquiryBulkEditForm.packageWidthCm) ?? "")
                        }
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-bulk-package-width",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
                          const next = e.target.value;
                          setInquiryBulkEditForm((prev) => {
                            if (inquiryBulkEditUnits === "cmkg") return { ...prev, packageWidthCm: next };
                            const t = next.trim();
                            if (!t) return { ...prev, packageWidthCm: "" };
                            const cm = inchesToCmValue(next);
                            if (cm == null) return prev;
                            return { ...prev, packageWidthCm: cm };
                          });
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-bulk-package-width"] = el;
                        }}
                        placeholder={(() => {
                          const v = inquiryBulkEditPreview?.packageWidthCm ?? "";
                          if (!v) return "留空不修改";
                          if (v.startsWith("（")) return `当前：${v}`;
                          if (inquiryBulkEditUnits === "cmkg") return `当前：${v}`;
                          const inch = cmToInchesValue(v);
                          return `当前：${inch ?? v}`;
                        })()}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                      <input
                        inputMode="decimal"
                        value={
                          inquiryBulkEditUnits === "cmkg"
                            ? inquiryBulkEditForm.packageHeightCm
                            : (cmToInchesValue(inquiryBulkEditForm.packageHeightCm) ?? "")
                        }
                        onChange={(e) => {
                          pendingInquiryModalFocus.current = {
                            key: "inquiry-bulk-package-height",
                            selectionStart: e.currentTarget.selectionStart,
                            selectionEnd: e.currentTarget.selectionEnd,
                          };
                          const next = e.target.value;
                          setInquiryBulkEditForm((prev) => {
                            if (inquiryBulkEditUnits === "cmkg") return { ...prev, packageHeightCm: next };
                            const t = next.trim();
                            if (!t) return { ...prev, packageHeightCm: "" };
                            const cm = inchesToCmValue(next);
                            if (cm == null) return prev;
                            return { ...prev, packageHeightCm: cm };
                          });
                        }}
                        ref={(el) => {
                          inquiryModalFieldRefs.current["inquiry-bulk-package-height"] = el;
                        }}
                        placeholder={(() => {
                          const v = inquiryBulkEditPreview?.packageHeightCm ?? "";
                          if (!v) return "留空不修改";
                          if (v.startsWith("（")) return `当前：${v}`;
                          if (inquiryBulkEditUnits === "cmkg") return `当前：${v}`;
                          const inch = cmToInchesValue(v);
                          return `当前：${inch ?? v}`;
                        })()}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">包裹重量（{inquiryBulkEditUnits === "cmkg" ? "kg" : "lb"}）</div>
                    <input
                      inputMode="decimal"
                      value={
                        inquiryBulkEditUnits === "cmkg"
                          ? inquiryBulkEditForm.packageWeightKg
                          : (kgToLbValue(inquiryBulkEditForm.packageWeightKg) ?? "")
                      }
                      onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-package-weight",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                        const next = e.target.value;
                        setInquiryBulkEditForm((prev) => {
                          if (inquiryBulkEditUnits === "cmkg") return { ...prev, packageWeightKg: next };
                          const t = next.trim();
                          if (!t) return { ...prev, packageWeightKg: "" };
                          const kg = lbToKgValue(next);
                          if (kg == null) return prev;
                          return { ...prev, packageWeightKg: kg };
                        });
                      }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-package-weight"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.packageWeightKg ?? "";
                        if (!v) return "留空不修改";
                        if (v.startsWith("（")) return `当前：${v}`;
                        if (inquiryBulkEditUnits === "cmkg") return `当前：${v}`;
                        const lb = kgToLbValue(v);
                        return `当前：${lb ?? v}`;
                      })()}
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
                      value={inquiryBulkEditForm.productUnitPrice}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-unit-price",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, productUnitPrice: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-unit-price"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.productUnitPrice ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">起订量</div>
                    <input
                      inputMode="numeric"
                      value={inquiryBulkEditForm.moq}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-moq",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, moq: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-moq"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.moq ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">优惠政策</div>
                    <div className="text-xs text-muted">
                      当前：{inquiryBulkEditPreview?.discountPolicy ? inquiryBulkEditPreview.discountPolicy : "—"}
                    </div>
                    <select
                      value={inquiryBulkEditForm.discountPolicy}
                      onChange={(e) => {
                        const next = (e.target.value as "" | "有" | "无") || "";
                        setInquiryBulkEditForm((prev) => ({
                          ...prev,
                          discountPolicy: next,
                          discountNote: next === "有" ? prev.discountNote : "",
                        }));
                      }}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">不修改</option>
                      <option value="有">有</option>
                      <option value="无">无</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <div className="text-xs text-muted">优惠备注</div>
                    <textarea
                      value={inquiryBulkEditForm.discountNote}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-discount-note",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, discountNote: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-discount-note"] = el;
                    }}
                      rows={3}
                      disabled={inquiryBulkEditForm.discountPolicy !== "有"}
                      placeholder={(() => {
                        if (inquiryBulkEditForm.discountPolicy !== "有") return "仅在选择“有”时可填";
                        const v = inquiryBulkEditPreview?.discountNote ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
                      className={[
                        "w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none",
                        inquiryBulkEditForm.discountPolicy !== "有" ? "cursor-not-allowed opacity-70" : "",
                      ].join(" ")}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm font-medium">工厂信息</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">主要工艺</div>
                    <div className="text-xs text-muted">
                      当前：{inquiryBulkEditPreview?.mainProcess ? inquiryBulkEditPreview.mainProcess : "—"}
                    </div>
                    <select
                      value={inquiryBulkEditForm.mainProcess}
                      onChange={(e) => setInquiryBulkEditForm((prev) => ({ ...prev, mainProcess: e.target.value }))}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    >
                      <option value="">不修改</option>
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
                      value={inquiryBulkEditForm.factoryLocation}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-factory-location",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, factoryLocation: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-factory-location"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.factoryLocation ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">联系人</div>
                    <input
                      value={inquiryBulkEditForm.factoryContact}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-factory-contact",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, factoryContact: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-factory-contact"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.factoryContact ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted">联系人电话</div>
                    <input
                      value={inquiryBulkEditForm.factoryPhone}
                    onChange={(e) => {
                      pendingInquiryModalFocus.current = {
                        key: "inquiry-bulk-factory-phone",
                        selectionStart: e.currentTarget.selectionStart,
                        selectionEnd: e.currentTarget.selectionEnd,
                      };
                      setInquiryBulkEditForm((prev) => ({ ...prev, factoryPhone: e.target.value }));
                    }}
                    ref={(el) => {
                      inquiryModalFieldRefs.current["inquiry-bulk-factory-phone"] = el;
                    }}
                      placeholder={(() => {
                        const v = inquiryBulkEditPreview?.factoryPhone ?? "";
                        if (!v) return "留空不修改";
                        return v.startsWith("（") ? `当前：${v}` : `当前：${v}`;
                      })()}
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
                setInquiryBulkEditOpen(false);
                setInquiryBulkEditAction(null);
                setInquiryBulkEditPreview(null);
                setInquiryBulkEditIds([]);
                setInquiryBulkEditSpecs([]);
                setInquiryBulkEditForm({
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
              }}
              disabled={inquiryBulkEditSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
              onClick={() => saveInquiryBulkEdit("confirm")}
              disabled={inquiryBulkEditSaving}
            >
              {inquiryBulkEditAction === "confirm" ? "提交中…" : "确认修改"}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              onClick={() => saveInquiryBulkEdit("submit")}
              disabled={inquiryBulkEditSaving}
            >
              {inquiryBulkEditAction === "submit" ? "提交中…" : "提交"}
            </button>
          </div>
        </EditModalShell>
      ) : null}

      {editing ? (
        (() => {
          const body = (
            <div
              onCompositionStartCapture={() => {
                editModalComposingRef.current = true;
                setIsComposing(true);
              }}
              onCompositionEndCapture={() => {
                editModalComposingRef.current = false;
                setIsComposing(false);
              }}
            >
              {schema ? (
              <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3">
                {(() => {
                  const baseFields = visibleFields.filter(
                    (f) => f !== "创建时间" && f !== "最后更新时间" && f !== "运营人员" && f !== "状态",
                  );
                  const selectionDataAllowed =
                    editCreateMode === "selectionData" && workspaceKey === "ops.selection" && editing.id == null
                      ? new Set([
                          "产品图片",
                          "名称",
                          "参考链接",
                          "平台在售价格（Min）",
                          "平台在售价格（Max）",
                          "所属类目",
                          "产品尺寸-长（厘米）",
                          "产品尺寸-宽（厘米）",
                          "产品尺寸-高（厘米）",
                          "产品重量",
                          "产品规格",
                          "资质要求",
                          "是否有专利风险",
                          "预计周平均日销量",
                          "建议采购价",
                          "热销月份",
                          "选品逻辑",
                        ])
                      : null;
                  const fields = selectionDataAllowed ? baseFields.filter((f) => selectionDataAllowed.has(f)) : baseFields;

                  const isPurchaseFlow =
                    workspaceKey === "ops.purchase" ||
                    workspaceKey === "ops.selection" ||
                    workspaceKey === "ops.inquiry" ||
                    workspaceKey === "ops.pricing" ||
                    workspaceKey === "ops.confirm";

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
                    const computedRange = null;
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
                        return { ...prev, data: { ...prev.data, [f]: next } };
                      });

                    const setValueWithComputed = (next: string) =>
                      setEditing((prev) => {
                        if (!prev) return prev;
                        const nextData: Record<string, string> = { ...prev.data, [f]: next };
                        return { ...prev, data: applyComputedFields(schema, nextData, lastMilePricing) };
                      });

                    const isMainProductImage = isPurchaseFlow && f === "产品图片";
                    const useRowLayout = isPurchaseFlow && workspaceKey !== "ops.confirm" && !opts?.hideLabel && kind !== "image";
                    if (f === "状态") return null;
                    if (f === "产品规格" && schema.fields.includes("产品规格输入方式")) {
                      const list =
                        linkDraftByField[f] ?? (() => {
                          const parsed = parseDelimitedValues(value);
                          return parsed.length > 0 ? parsed : [""];
                        })();

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
                              <div className="flex flex-col gap-2">
                                {list.map((it, idx) => {
                                  return (
                                    <div key={idx} className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={it}
                                        onCompositionStart={() => {
                                          editModalComposingRef.current = true;
                                          setIsComposing(true);
                                        }}
                                        onCompositionEnd={(e) => {
                                          editModalComposingRef.current = false;
                                          setIsComposing(false);
                                          const nextList = list.map((v, i) => (i === idx ? e.currentTarget.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                        onChange={(e) => {
                                          const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                          setValue(joinDelimitedValues(nextList));
                                        }}
                                        ref={(el) => {
                                          editModalFieldRefs.current[`edit-${f}-${idx}`] = el;
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
                                  );
                                })}
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
                                          return {
                                            ...prev,
                                            data: {
                                              ...prev.data,
                                              [f]: next,
                                              [descField]: next === "是" ? prev.data[descField] ?? "" : "",
                                            },
                                          };
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
                                        onCompositionStart={() => {
                                          editModalComposingRef.current = true;
                                          setIsComposing(true);
                                        }}
                                        onCompositionEnd={() => {
                                          editModalComposingRef.current = false;
                                          setIsComposing(false);
                                        }}
                                        onChange={(e) => {
                                          setEditing((prev) => {
                                            if (!prev) return prev;
                                            return { ...prev, data: { ...prev.data, [descField]: e.target.value } };
                                          });
                                        }}
                                        ref={(el) => {
                                          editModalFieldRefs.current[`edit-${descField}`] = el;
                                        }}
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
                              const list =
                                linkDraftByField[f] ?? (() => {
                                  const parsed = parseDelimitedValues(value);
                                  return parsed.length > 0 ? parsed : [""];
                                })();

                              return (
                                <div className="flex flex-col gap-2">
                                  <div className="flex flex-col gap-2">
                                    {list.map((it, idx) => {
                                      return (
                                        <div key={idx} className="flex items-center gap-2">
                                          <input
                                            type="text"
                                            value={it}
                                            onCompositionStart={() => {
                                              editModalComposingRef.current = true;
                                              setIsComposing(true);
                                            }}
                                            onCompositionEnd={(e) => {
                                              editModalComposingRef.current = false;
                                              setIsComposing(false);
                                              const nextList = list.map((v, i) => (i === idx ? e.currentTarget.value : v));
                                              setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                              setValue(joinDelimitedValues(nextList));
                                            }}
                                            onChange={(e) => {
                                              const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                              setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                              setValue(joinDelimitedValues(nextList));
                                            }}
                                            ref={(el) => {
                                              editModalFieldRefs.current[`edit-${f}-${idx}`] = el;
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
                                      );
                                    })}
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
                                        ref={(el) => {
                                          linkInputRefs.current[`${f}-${idx}`] = el;
                                        }}
                                        type="url"
                                        value={it}
                                        onCompositionStart={() => {
                                          editModalComposingRef.current = true;
                                          setIsComposing(true);
                                        }}
                                        onCompositionEnd={(e) => {
                                          editModalComposingRef.current = false;
                                          setIsComposing(false);
                                          pendingLinkFocusKey.current = `${f}-${idx}`;
                                          const nextList = list.map((v, i) => (i === idx ? e.currentTarget.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
                                        }}
                                        onChange={(e) => {
                                          pendingLinkFocusKey.current = `${f}-${idx}`;
                                          const nextList = list.map((v, i) => (i === idx ? e.target.value : v));
                                          setLinkDraftByField((prev) => ({ ...prev, [f]: nextList }));
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
                                      ref={(el) => {
                                        editModalFieldRefs.current[`edit-${f}`] = el;
                                      }}
                                      onFocus={() => {
                                        editModalLastFocusedKey.current = `edit-${f}`;
                                      }}
                                      onCompositionStart={() => {
                                        editModalComposingRef.current = true;
                                        setIsComposing(true);
                                      }}
                                      onCompositionEnd={(e) => {
                                        editModalComposingRef.current = false;
                                        setIsComposing(false);
                                        setValue(e.currentTarget.value);
                                      }}
                                      onChange={(e) => {
                                        pendingEditModalFocus.current = {
                                          key: `edit-${f}`,
                                          selectionStart: e.currentTarget.selectionStart,
                                          selectionEnd: e.currentTarget.selectionEnd,
                                        };
                                        setValue(e.target.value);
                                      }}
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
                              ref={(el) => {
                                editModalFieldRefs.current[`edit-${f}`] = el;
                              }}
                              onFocus={() => {
                                editModalLastFocusedKey.current = `edit-${f}`;
                              }}
                              onCompositionStart={() => {
                                editModalComposingRef.current = true;
                                setIsComposing(true);
                              }}
                              onCompositionEnd={(e) => {
                                editModalComposingRef.current = false;
                                setIsComposing(false);
                                if (kind === "number") {
                                  setValueWithComputed(sanitizeDecimalInput(e.currentTarget.value));
                                  return;
                                }
                                setValue(e.currentTarget.value);
                              }}
                              onChange={(e) => {
                                if (kind === "number") {
                                  pendingEditModalFocus.current = {
                                    key: `edit-${f}`,
                                    selectionStart: e.currentTarget.selectionStart,
                                    selectionEnd: e.currentTarget.selectionEnd,
                                  };
                                  setValueWithComputed(sanitizeDecimalInput(e.target.value));
                                  return;
                                }
                                setValue(e.target.value);
                              }}
                              onKeyDown={
                                kind === "number"
                                  ? (e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }
                                  : undefined
                              }
                              onPaste={
                                kind === "number"
                                  ? (e) => {
                                      const text = e.clipboardData.getData("text");
                                      const next = sanitizeDecimalInput(text);
                                      if (!next) return;
                                      e.preventDefault();
                                      setValueWithComputed(next);
                                    }
                                  : undefined
                              }
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

                  if (workspaceKey === "ops.confirm") {
                    const unitBtnBase =
                      "inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors";
                    const unitBtnActive = "border-primary bg-primary text-white";
                    const unitBtnInactive = "border-border bg-surface text-muted hover:bg-surface-2";

                    const renderDimRow = (label: string, a: string, b: string, c: string, readonly = false) => {
                      if (!schema.fields.includes(a) || !schema.fields.includes(b) || !schema.fields.includes(c)) return null;
                      const aRaw = editing.data[a] ?? "";
                      const bRaw = editing.data[b] ?? "";
                      const cRaw = editing.data[c] ?? "";
                      const showA = confirmUnits === "cmkg" ? aRaw : cmToInchesValue(aRaw) ?? "";
                      const showB = confirmUnits === "cmkg" ? bRaw : cmToInchesValue(bRaw) ?? "";
                      const showC = confirmUnits === "cmkg" ? cRaw : cmToInchesValue(cRaw) ?? "";
                      const setField = (field: string, next: string) =>
                        setEditing((prev) => {
                          if (!prev) return prev;
                          const nextData: Record<string, string> = { ...prev.data, [field]: next };
                          return { ...prev, data: applyComputedFields(schema, nextData, lastMilePricing) };
                        });
                      const setFromDisplay = (field: string, display: string) => {
                        const raw = sanitizeDecimalInput(display);
                        if (confirmUnits === "cmkg") return setField(field, raw);
                        const cm = inchesToCmValue(raw);
                        return setField(field, cm ?? "");
                      };
                      return (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <div className="text-xs text-muted sm:w-28 sm:shrink-0">
                            {label}（{confirmUnits === "cmkg" ? "cm" : "in"}）
                          </div>
                          <div className="grid grid-cols-3 gap-2 sm:flex-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showA}
                              onChange={readonly ? undefined : (e) => setFromDisplay(a, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(a, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="长"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showB}
                              onChange={readonly ? undefined : (e) => setFromDisplay(b, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(b, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="宽"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showC}
                              onChange={readonly ? undefined : (e) => setFromDisplay(c, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(c, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="高"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                          </div>
                        </div>
                      );
                    };

                    const renderWeightRow = (label: string, field: string, readonly = false) => {
                      if (!schema.fields.includes(field)) return null;
                      const raw = editing.data[field] ?? "";
                      const show = confirmUnits === "cmkg" ? raw : kgToLbValue(raw) ?? "";
                      const setField = (next: string) =>
                        setEditing((prev) => {
                          if (!prev) return prev;
                          const nextData: Record<string, string> = { ...prev.data, [field]: next };
                          return { ...prev, data: applyComputedFields(schema, nextData, lastMilePricing) };
                        });
                      const setFromDisplay = (display: string) => {
                        const v = sanitizeDecimalInput(display);
                        if (confirmUnits === "cmkg") return setField(v);
                        const kg = lbToKgValue(v);
                        return setField(kg ?? "");
                      };
                      return (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <div className="text-xs text-muted sm:w-28 sm:shrink-0">
                            {label}（{confirmUnits === "cmkg" ? "kg" : "lb"}）
                          </div>
                          <div className="min-w-0 sm:flex-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={show}
                              onChange={readonly ? undefined : (e) => setFromDisplay(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                          </div>
                        </div>
                      );
                    };

                    const statusBadge = (() => {
                      const status = String(editing.data["状态"] ?? "").trim();
                      const cls =
                        status === "待确品"
                          ? "bg-blue-50 text-blue-600 border-blue-200"
                          : status === "待采购"
                            ? "bg-orange-50 text-orange-600 border-orange-200"
                            : "bg-surface-2 text-muted border-border";
                      return (
                        <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs", cls].join(" ")}>
                          {status || "—"}
                        </span>
                      );
                    })();

                    const costTotalRaw = String(editing.data["成本总计"] ?? "").trim();
                    const costTotal = costTotalRaw ? `¥${costTotalRaw}` : "—";

                    const renderCard = (titleText: string, right?: ReactNode, content?: ReactNode) => {
                      return (
                        <div className="rounded-2xl border border-border bg-surface p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-lg font-semibold">{titleText}</div>
                            {right ? <div className="shrink-0">{right}</div> : null}
                          </div>
                          {content ? <div className="mt-4">{content}</div> : null}
                        </div>
                      );
                    };

                    const unitToggle = (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={[unitBtnBase, confirmUnits === "cmkg" ? unitBtnActive : unitBtnInactive].join(" ")}
                          onClick={() => setConfirmUnits("cmkg")}
                        >
                          cmkg
                        </button>
                        <button
                          type="button"
                          className={[unitBtnBase, confirmUnits === "inlb" ? unitBtnActive : unitBtnInactive].join(" ")}
                          onClick={() => setConfirmUnits("inlb")}
                        >
                          英寸/英镑
                        </button>
                      </div>
                    );

                    const setFieldValue = (field: string, next: string) =>
                      setEditing((prev) => {
                        if (!prev) return prev;
                        return { ...prev, data: applyComputedFields(schema, { ...prev.data, [field]: next }, lastMilePricing) };
                      });

                    const parsePairs = (raw: string) => {
                      const list = parseDelimitedValues(raw);
                      return list
                        .map((it) => {
                          const [a, b] = it.split("|");
                          return { label: (a ?? "").trim(), value: (b ?? "").trim() };
                        })
                        .filter((it) => it.label || it.value);
                    };

                    const serializePairs = (pairs: { label: string; value: string }[]) => {
                      return joinDelimitedValues(pairs.map((p) => `${p.label}|${p.value}`));
                    };

                    const warehouseNames = ["美西仓", "美东仓", "深圳仓"] as const;
                    const platformNames = ["TEUM"] as const;
                    const qtyFields = ["美西仓", "美东仓", "深圳仓"] as const;

                    const renderPriceRangeRow = () => {
                      if (!schema.fields.includes("平台在售价格（Min）") && !schema.fields.includes("平台在售价格（Max）")) return null;
                      const isFixed = String(editing.data["平台在售价格模式"] ?? "") === "固定价格";
                      return (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <div className="text-xs text-muted sm:w-28 sm:shrink-0">平台在售价格</div>
                          <div className="flex flex-1 items-center gap-2">
                            {schema.fields.includes("平台在售价格模式") ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isFixed ? "" : "固定价格";
                                  setFieldValue("平台在售价格模式", next);
                                  if (!isFixed) setFieldValue("平台在售价格（Max）", "");
                                }}
                                className={`shrink-0 rounded border px-2 py-1 text-xs ${isFixed ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:border-primary/50"}`}
                              >
                                固定价格
                              </button>
                            ) : null}
                            {isFixed ? (
                              <div className="flex-1">
                                {schema.fields.includes("平台在售价格（Min）") ? renderField("平台在售价格（Min）", { hideLabel: true }) : null}
                              </div>
                            ) : (
                              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                                {schema.fields.includes("平台在售价格（Min）") ? renderField("平台在售价格（Min）", { hideLabel: true }) : null}
                                {schema.fields.includes("平台在售价格（Max）") ? renderField("平台在售价格（Max）", { hideLabel: true }) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    };

                    const renderReadonlyImage = () => {
                      if (!schema.fields.includes("产品图片")) return null;
                      const imageRaw = String(editing.data["产品图片"] ?? "");
                      const urls = parseImageUrls(imageRaw).filter(looksLikeImagePath);
                      const first = urls[0] ?? "";
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="text-xs text-muted">产品图片</div>
                          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-4">
                            {first ? (
                              <button
                                type="button"
                                className="block w-full"
                                onClick={() => {
                                  openImageViewer(urls, 0);
                                }}
                              >
                                <Image
                                  src={first}
                                  alt="产品图片"
                                  width={640}
                                  height={360}
                                  className="h-40 w-full rounded-lg border border-border bg-surface object-cover"
                                />
                              </button>
                            ) : (
                              <div className="flex h-40 items-center justify-center text-sm text-muted">—</div>
                            )}
                          </div>
                        </div>
                      );
                    };

                    const renderReadonlyLinks = () => {
                      if (!schema.fields.includes("参考链接")) return null;
                      const raw = String(editing.data["参考链接"] ?? "");
                      const list = parseDelimitedValues(raw).filter(looksLikeUrl);
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="text-xs text-muted">参考链接</div>
                          {list.length === 0 ? (
                            <div className="text-sm text-muted">—</div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {list.map((u, idx) => (
                                <a
                                  key={`${u}-${idx}`}
                                  href={u}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground underline hover:bg-surface-2"
                                  title={u}
                                >
                                  {u}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div className="flex flex-col gap-4">
                        {renderCard(
                          "基本信息",
                          <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>,
                          <div className="grid gap-4 sm:grid-cols-[10rem,1fr]">
                            <div>{renderReadonlyImage()}</div>
                            <div className="flex flex-col gap-3">
                              {fields.includes("名称") ? renderField("名称") : null}
                              {renderReadonlyLinks()}
                              {renderPriceRangeRow()}
                              {fields.includes("所属类目") ? renderField("所属类目") : null}
                            </div>
                          </div>,
                        )}

                        {renderCard(
                          "产品属性",
                          unitToggle,
                          <div className="flex flex-col gap-3">
                            {renderDimRow("产品尺寸", "产品尺寸-长（厘米）", "产品尺寸-宽（厘米）", "产品尺寸-高（厘米）", true)}
                            {renderWeightRow("产品重量", "产品重量", true)}
                            {fields.includes("产品规格") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">产品规格</div>
                                <input
                                  value={String(editing.data["产品规格"] ?? "")}
                                  readOnly
                                  disabled
                                  className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "单套属性",
                          unitToggle,
                          <div className="flex flex-col gap-3">
                            {renderDimRow("单套尺寸", "单套尺寸-长（厘米）", "单套尺寸-宽（厘米）", "单套尺寸-高（厘米）", true)}
                            {renderWeightRow("包裹重量", "包裹实重（公斤）", true)}
                          </div>,
                        )}

                        {renderCard(
                          "核价信息",
                          null,
                          <div className="flex flex-col gap-4">
                            <div>
                              <div className="text-xs text-muted">成本总计（RMB）</div>
                              <div className="mt-2 text-2xl font-bold text-foreground">{costTotal}</div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {fields.includes("采购成本") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">采购成本</div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["采购成本"] ?? "")}
                                    onChange={(e) => setFieldValue("采购成本", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                  />
                                </div>
                              ) : null}
                              {fields.includes("头程成本") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">头程成本</div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["头程成本"] ?? "")}
                                    onChange={(e) => setFieldValue("头程成本", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                  />
                                </div>
                              ) : null}
                              {fields.includes("尾程成本（人民币）") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">尾程成本（人民币）</div>
                                  <input
                                    value={String(editing.data["尾程成本（人民币）"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                              {fields.includes("负向成本") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">负向成本</div>
                                  <input
                                    value={String(editing.data["负向成本"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {fields.includes("temu报价") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">TEUM供货价</div>
                                  <input
                                    value={String(editing.data["temu报价"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                              {(fields.includes("平台在售价格（Min）") || fields.includes("平台在售价格（Max）")) && (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">
                                    {String(editing.data["平台在售价格模式"] ?? "") === "固定价格" ? "参考销售售价（固定价格）" : "参考销售售价（MIN，MAX）"}
                                  </div>
                                  {String(editing.data["平台在售价格模式"] ?? "") === "固定价格" ? (
                                    <input
                                      value={String(editing.data["平台在售价格（Min）"] ?? "")}
                                      readOnly
                                      disabled
                                      className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                    />
                                  ) : (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <input
                                        value={String(editing.data["平台在售价格（Min）"] ?? "")}
                                        readOnly
                                        disabled
                                        className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                      />
                                      <input
                                        value={String(editing.data["平台在售价格（Max）"] ?? "")}
                                        readOnly
                                        disabled
                                        className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>,
                        )}

                        {renderCard(
                          "SKU信息",
                          null,
                          <div className="flex flex-col gap-4">
                            {schema.fields.includes("公司物料代码") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">公司商品编码</div>
                                <input
                                  value={String(editing.data["公司物料代码"] ?? "")}
                                  onChange={(e) => setFieldValue("公司物料代码", e.target.value)}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}

                            {schema.fields.includes("仓库编码") ? (
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium">仓库条码</div>
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                                    onClick={() => {
                                      const current = parsePairs(String(editing.data["仓库编码"] ?? ""));
                                      const used = new Set(current.map((it) => it.label));
                                      const nextLabel = warehouseNames.find((w) => !used.has(w)) ?? warehouseNames[0];
                                      const next = [...current, { label: nextLabel, value: "" }];
                                      setFieldValue("仓库编码", serializePairs(next));
                                    }}
                                  >
                                    <Plus className="h-4 w-4" />
                                    增加仓库条码
                                  </button>
                                </div>
                                <div className="mt-4 flex flex-col gap-3">
                                  {(() => {
                                    const list = parsePairs(String(editing.data["仓库编码"] ?? ""));
                                    if (list.length === 0) return <div className="text-sm text-muted">暂无</div>;
                                    return list.map((it, idx) => {
                                      return (
                                        <div
                                          key={`${it.label}-${idx}`}
                                          className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3"
                                        >
                                          <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-medium">
                                            {it.label || "—"}
                                          </div>
                                          <input
                                            value={it.value}
                                            onChange={(e) => {
                                              const next = list.map((v, i) => (i === idx ? { ...v, value: e.target.value } : v));
                                              setFieldValue("仓库编码", serializePairs(next));
                                            }}
                                            className="h-10 flex-1 rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                          />
                                          <button
                                            type="button"
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                                            onClick={() => {
                                              const next = list.filter((_, i) => i !== idx);
                                              setFieldValue("仓库编码", serializePairs(next));
                                            }}
                                            title="删除"
                                          >
                                            <Trash2 className="h-4 w-4 text-muted" />
                                          </button>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            ) : null}

                            {schema.fields.includes("平台编码") ? (
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium">平台编码</div>
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                                    onClick={() => {
                                      const current = parsePairs(String(editing.data["平台编码"] ?? ""));
                                      const used = new Set(current.map((it) => it.label));
                                      const nextLabel = platformNames.find((p) => !used.has(p)) ?? platformNames[0];
                                      const next = [...current, { label: nextLabel, value: "" }];
                                      setFieldValue("平台编码", serializePairs(next));
                                    }}
                                  >
                                    <Plus className="h-4 w-4" />
                                    增加平台编码
                                  </button>
                                </div>
                                <div className="mt-4 flex flex-col gap-3">
                                  {(() => {
                                    const list = parsePairs(String(editing.data["平台编码"] ?? ""));
                                    if (list.length === 0) return <div className="text-sm text-muted">暂无</div>;
                                    return list.map((it, idx) => {
                                      return (
                                        <div
                                          key={`${it.label}-${idx}`}
                                          className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3"
                                        >
                                          <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-medium">
                                            {it.label || "—"}
                                          </div>
                                          <input
                                            value={it.value}
                                            onChange={(e) => {
                                              const next = list.map((v, i) => (i === idx ? { ...v, value: e.target.value } : v));
                                              setFieldValue("平台编码", serializePairs(next));
                                            }}
                                            className="h-10 flex-1 rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                          />
                                          <button
                                            type="button"
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                                            onClick={() => {
                                              const next = list.filter((_, i) => i !== idx);
                                              setFieldValue("平台编码", serializePairs(next));
                                            }}
                                            title="删除"
                                          >
                                            <Trash2 className="h-4 w-4 text-muted" />
                                          </button>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "发货信息",
                          <button
                            type="button"
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                            onClick={() => {
                              const candidates = qtyFields.filter((f) => schema.fields.includes(f));
                              const current = candidates.filter((f) => String(editing.data[f] ?? "").trim());
                              const used = new Set(current);
                              const next = candidates.find((f) => !used.has(f));
                              if (!next) return;
                              setFieldValue(next, "0");
                            }}
                          >
                            <Plus className="h-4 w-4" />
                            添加仓库
                          </button>,
                          <div className="flex flex-col gap-3">
                            <div className="text-xs text-muted">多个仓库信息</div>
                            {(() => {
                              const candidates = qtyFields.filter((f) => schema.fields.includes(f));
                              const active = candidates.filter((f) => String(editing.data[f] ?? "").trim());
                              if (active.length === 0) return <div className="text-sm text-muted">暂无</div>;
                              return active.map((f) => {
                                const v = String(editing.data[f] ?? "");
                                return (
                                  <div key={f} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                                    <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-semibold">
                                      {f}
                                    </div>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      value={v}
                                      onChange={(e) => setFieldValue(f, sanitizeDecimalInput(e.target.value))}
                                      onKeyDown={(e) => {
                                        if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                      }}
                                      onWheel={(e) => {
                                        e.currentTarget.blur();
                                      }}
                                      className="h-10 flex-1 rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                    />
                                    <button
                                      type="button"
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                                      onClick={() => setFieldValue(f, "")}
                                      title="删除"
                                    >
                                      <Trash2 className="h-4 w-4 text-muted" />
                                    </button>
                                  </div>
                                );
                              });
                            })()}
                          </div>,
                        )}

                        {renderCard(
                          "销售预估",
                          null,
                          <div className="flex flex-col gap-3">
                            {schema.fields.includes("预估来源") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">预估来源</div>
                                <input
                                  value={String(editing.data["预估来源"] ?? "")}
                                  onChange={(e) => setFieldValue("预估来源", e.target.value)}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                            {schema.fields.includes("预估销量") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">预估销量</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["预估销量"] ?? "")}
                                  onChange={(e) => setFieldValue("预估销量", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}
                      </div>
                    );
                  }

                  if (workspaceKey === "ops.purchase") {
                    const unitBtnBase =
                      "inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors";
                    const unitBtnActive = "border-primary bg-primary text-white";
                    const unitBtnInactive = "border-border bg-surface text-muted hover:bg-surface-2";

                    const setFieldValue = (field: string, next: string) =>
                      setEditing((prev) => {
                        if (!prev) return prev;
                        return { ...prev, data: applyComputedFields(schema, { ...prev.data, [field]: next }, lastMilePricing) };
                      });

                    const renderDimRow = (label: string, a: string, b: string, c: string, readonly = false) => {
                      if (!schema.fields.includes(a) || !schema.fields.includes(b) || !schema.fields.includes(c)) return null;
                      const aRaw = editing.data[a] ?? "";
                      const bRaw = editing.data[b] ?? "";
                      const cRaw = editing.data[c] ?? "";
                      const showA = purchaseUnits === "cmkg" ? aRaw : cmToInchesValue(aRaw) ?? "";
                      const showB = purchaseUnits === "cmkg" ? bRaw : cmToInchesValue(bRaw) ?? "";
                      const showC = purchaseUnits === "cmkg" ? cRaw : cmToInchesValue(cRaw) ?? "";
                      const setFromDisplay = (field: string, display: string) => {
                        const raw = sanitizeDecimalInput(display);
                        if (purchaseUnits === "cmkg") return setFieldValue(field, raw);
                        const cm = inchesToCmValue(raw);
                        return setFieldValue(field, cm ?? "");
                      };
                      return (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <div className="text-xs text-muted sm:w-28 sm:shrink-0">
                            {label}（{purchaseUnits === "cmkg" ? "cm" : "in"}）
                          </div>
                          <div className="grid grid-cols-3 gap-2 sm:flex-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showA}
                              onChange={readonly ? undefined : (e) => setFromDisplay(a, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(a, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="长"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showB}
                              onChange={readonly ? undefined : (e) => setFromDisplay(b, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(b, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="宽"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              type="number"
                              inputMode="decimal"
                              value={showC}
                              onChange={readonly ? undefined : (e) => setFromDisplay(c, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(c, next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              placeholder="高"
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                          </div>
                        </div>
                      );
                    };

                    const renderWeightRow = (label: string, field: string, readonly = false) => {
                      if (!schema.fields.includes(field)) return null;
                      const raw = editing.data[field] ?? "";
                      const show = purchaseUnits === "cmkg" ? raw : kgToLbValue(raw) ?? "";
                      const setFromDisplay = (display: string) => {
                        const v = sanitizeDecimalInput(display);
                        if (purchaseUnits === "cmkg") return setFieldValue(field, v);
                        const kg = lbToKgValue(v);
                        return setFieldValue(field, kg ?? "");
                      };
                      return (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <div className="text-xs text-muted sm:w-28 sm:shrink-0">
                            {label}（{purchaseUnits === "cmkg" ? "kg" : "lb"}）
                          </div>
                          <div className="min-w-0 sm:flex-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={show}
                              onChange={readonly ? undefined : (e) => setFromDisplay(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                const next = sanitizeDecimalInput(text);
                                if (!next) return;
                                e.preventDefault();
                                if (!readonly) setFromDisplay(next);
                              }}
                              onWheel={(e) => {
                                e.currentTarget.blur();
                              }}
                              readOnly={readonly}
                              disabled={readonly}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            />
                          </div>
                        </div>
                      );
                    };

                    const unitToggle = (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={[unitBtnBase, purchaseUnits === "cmkg" ? unitBtnActive : unitBtnInactive].join(" ")}
                          onClick={() => setPurchaseUnits("cmkg")}
                        >
                          cmkg
                        </button>
                        <button
                          type="button"
                          className={[unitBtnBase, purchaseUnits === "inlb" ? unitBtnActive : unitBtnInactive].join(" ")}
                          onClick={() => setPurchaseUnits("inlb")}
                        >
                          英寸/英镑
                        </button>
                      </div>
                    );

                    const parsePairs = (raw: string) => {
                      const list = parseDelimitedValues(raw);
                      return list
                        .map((it) => {
                          const [a, b] = it.split("|");
                          return { label: (a ?? "").trim(), value: (b ?? "").trim() };
                        })
                        .filter((it) => it.label || it.value);
                    };

                    const serializePairs = (pairs: { label: string; value: string }[]) => {
                      return joinDelimitedValues(pairs.map((p) => `${p.label}|${p.value}`));
                    };

                    const renderCard = (titleText: string, right?: ReactNode, content?: ReactNode) => {
                      return (
                        <div className="rounded-2xl border border-border bg-surface p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-lg font-semibold">{titleText}</div>
                            {right ? <div className="shrink-0">{right}</div> : null}
                          </div>
                          {content ? <div className="mt-4">{content}</div> : null}
                        </div>
                      );
                    };

                    const renderReadonlyImage = () => {
                      if (!schema.fields.includes("产品图片")) return null;
                      const imageRaw = String(editing.data["产品图片"] ?? "");
                      const urls = parseImageUrls(imageRaw).filter(looksLikeImagePath);
                      const first = urls[0] ?? "";
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="text-xs text-muted">产品图片</div>
                          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-4">
                            {first ? (
                              <button
                                type="button"
                                className="block w-full"
                                onClick={() => {
                                  openImageViewer(urls, 0);
                                }}
                              >
                                <Image
                                  src={first}
                                  alt="产品图片"
                                  width={640}
                                  height={360}
                                  className="h-40 w-full rounded-lg border border-border bg-surface object-cover"
                                />
                              </button>
                            ) : (
                              <div className="flex h-40 items-center justify-center text-sm text-muted">—</div>
                            )}
                          </div>
                        </div>
                      );
                    };

                    const renderReadonlyLinks = () => {
                      if (!schema.fields.includes("参考链接")) return null;
                      const raw = String(editing.data["参考链接"] ?? "");
                      const list = parseDelimitedValues(raw).filter(looksLikeUrl);
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="text-xs text-muted">参考链接</div>
                          {list.length === 0 ? (
                            <div className="text-sm text-muted">—</div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {list.map((u, idx) => (
                                <a
                                  key={`${u}-${idx}`}
                                  href={u}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground underline hover:bg-surface-2"
                                  title={u}
                                >
                                  {u}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    };

                    const warehouseNames = ["美西仓", "美东仓", "深圳仓"] as const;
                    const platformNames = ["TEUM"] as const;
                    const qtyFields = ["美西仓", "美东仓", "深圳仓"] as const;

                    return (
                      <div className="flex flex-col gap-4">
                        {renderCard(
                          "基本信息",
                          <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>,
                          <div className="grid gap-4 sm:grid-cols-[10rem,1fr]">
                            <div>{renderReadonlyImage()}</div>
                            <div className="flex flex-col gap-3">
                              {schema.fields.includes("名称") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">商品名称</div>
                                  <input
                                    value={String(editing.data["名称"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                              {renderReadonlyLinks()}
                              {schema.fields.includes("所属类目") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">所属类目</div>
                                  <input
                                    value={String(editing.data["所属类目"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                            </div>
                          </div>,
                        )}

                        {renderCard(
                          "SKU信息",
                          <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>,
                          <div className="flex flex-col gap-4">
                            {schema.fields.includes("公司物料代码") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">公司商品编码</div>
                                <input
                                  value={String(editing.data["公司物料代码"] ?? "")}
                                  onChange={(e) => setFieldValue("公司物料代码", e.target.value)}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}

                            {schema.fields.includes("仓库编码") ? (
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <div className="text-sm font-medium">仓库条码</div>
                                <div className="mt-4 flex flex-col gap-3">
                                  {(() => {
                                    const list = parsePairs(String(editing.data["仓库编码"] ?? ""));
                                    if (list.length === 0) return <div className="text-sm text-muted">暂无</div>;
                                    return list.map((it, idx) => (
                                      <div
                                        key={`${it.label}-${idx}`}
                                        className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3"
                                      >
                                        <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-medium">
                                          {it.label || "—"}
                                        </div>
                                        <input
                                          value={it.value}
                                          readOnly
                                          disabled
                                          className="h-10 flex-1 cursor-not-allowed rounded-xl border border-border bg-surface px-4 text-sm outline-none opacity-70"
                                        />
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </div>
                            ) : null}

                            {schema.fields.includes("平台编码") ? (
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <div className="text-sm font-medium">平台编码</div>
                                <div className="mt-4 flex flex-col gap-3">
                                  {(() => {
                                    const list = parsePairs(String(editing.data["平台编码"] ?? ""));
                                    if (list.length === 0) return <div className="text-sm text-muted">暂无</div>;
                                    return list.map((it, idx) => (
                                      <div
                                        key={`${it.label}-${idx}`}
                                        className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3"
                                      >
                                        <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-medium">
                                          {it.label || "—"}
                                        </div>
                                        <input
                                          value={it.value}
                                          readOnly
                                          disabled
                                          className="h-10 flex-1 cursor-not-allowed rounded-xl border border-border bg-surface px-4 text-sm outline-none opacity-70"
                                        />
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "产品属性",
                          unitToggle,
                          <div className="flex flex-col gap-3">
                            {renderDimRow("产品尺寸", "产品尺寸-长（厘米）", "产品尺寸-宽（厘米）", "产品尺寸-高（厘米）", true)}
                            {renderWeightRow("产品重量", "产品重量", true)}
                            {schema.fields.includes("产品规格") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">产品规格</div>
                                <input
                                  value={String(editing.data["产品规格"] ?? "")}
                                  readOnly
                                  disabled
                                  className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "单套属性",
                          unitToggle,
                          <div className="flex flex-col gap-3">
                            {renderDimRow("单套尺寸", "单套尺寸-长（厘米）", "单套尺寸-宽（厘米）", "单套尺寸-高（厘米）", true)}
                            {renderWeightRow("包裹重量", "包裹实重（公斤）", true)}
                            {schema.fields.includes("包裹计费重") ? (
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">包裹计费重</div>
                                <input
                                  value={String(editing.data["包裹计费重"] ?? "")}
                                  readOnly
                                  disabled
                                  className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-3 text-sm outline-none opacity-70"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "发货信息",
                          <div className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">只读</div>,
                          <div className="flex flex-col gap-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {schema.fields.includes("计划采购量") ? (
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted">计划采购量</div>
                                  <input
                                    value={String(editing.data["计划采购量"] ?? "")}
                                    readOnly
                                    disabled
                                    className="h-12 w-full cursor-not-allowed rounded-xl border border-border bg-surface px-4 text-sm outline-none opacity-70"
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-col gap-3">
                              <div className="text-xs text-muted">多个仓库信息</div>
                              {(() => {
                                const candidates = qtyFields.filter((f) => schema.fields.includes(f));
                                const active = candidates.filter((f) => String(editing.data[f] ?? "").trim());
                                if (active.length === 0) return <div className="text-sm text-muted">暂无</div>;
                                return active.map((f) => {
                                  const v = String(editing.data[f] ?? "");
                                  return (
                                    <div key={f} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                                      <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-semibold">
                                        {f}
                                      </div>
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        value={v}
                                        readOnly
                                        disabled
                                        className="h-10 flex-1 cursor-not-allowed rounded-xl border border-border bg-surface px-4 text-sm outline-none opacity-70"
                                      />
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>,
                        )}

                        {renderCard(
                          "实际单套属性",
                          null,
                          <div className="flex flex-col gap-4">
                            {schema.fields.includes("外箱尺寸-长（厘米）") &&
                            schema.fields.includes("外箱尺寸-宽（厘米）") &&
                            schema.fields.includes("外箱尺寸-高（厘米）") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">实际单套尺寸（长 / 宽 / 高，cm）</div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["外箱尺寸-长（厘米）"] ?? "")}
                                    onChange={(e) => setFieldValue("外箱尺寸-长（厘米）", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => {
                                      e.currentTarget.blur();
                                    }}
                                    placeholder="长"
                                    className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                  />
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["外箱尺寸-宽（厘米）"] ?? "")}
                                    onChange={(e) => setFieldValue("外箱尺寸-宽（厘米）", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => {
                                      e.currentTarget.blur();
                                    }}
                                    placeholder="宽"
                                    className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                  />
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["外箱尺寸-高（厘米）"] ?? "")}
                                    onChange={(e) => setFieldValue("外箱尺寸-高（厘米）", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => {
                                      e.currentTarget.blur();
                                    }}
                                    placeholder="高"
                                    className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                  />
                                </div>
                              </div>
                            ) : null}

                            {schema.fields.includes("外箱实重") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">实际包裹重量（kg）</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["外箱实重"] ?? "")}
                                  onChange={(e) => setFieldValue("外箱实重", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "下单数",
                          null,
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">总单数（箱规 × 箱数）</div>
                                <input
                                  value={String(editing.data["下单数"] ?? "")}
                                  readOnly
                                  disabled
                                  className="h-12 w-full cursor-not-allowed rounded-xl border border-border bg-surface px-4 text-sm font-semibold outline-none opacity-70"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">箱规</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["箱规"] ?? "")}
                                  onChange={(e) => {
                                    const next = sanitizeDecimalInput(e.target.value);
                                    const boxCountRaw = String(editing.data["出货箱数"] ?? "");
                                    const boxCount = Number(sanitizeDecimalInput(boxCountRaw));
                                    const boxSpec = Number(next);
                                    setFieldValue("箱规", next);
                                    if (Number.isFinite(boxSpec) && boxSpec > 0 && Number.isFinite(boxCount) && boxCount > 0) {
                                      setFieldValue("下单数", String(Math.round(boxSpec * boxCount)));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <div className="text-xs text-muted">箱数</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["出货箱数"] ?? "")}
                                  onChange={(e) => {
                                    const next = sanitizeDecimalInput(e.target.value);
                                    const boxSpecRaw = String(editing.data["箱规"] ?? "");
                                    const boxSpec = Number(sanitizeDecimalInput(boxSpecRaw));
                                    const boxCount = Number(next);
                                    setFieldValue("出货箱数", next);
                                    if (Number.isFinite(boxSpec) && boxSpec > 0 && Number.isFinite(boxCount) && boxCount > 0) {
                                      setFieldValue("下单数", String(Math.round(boxSpec * boxCount)));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            </div>

                            <div className="flex flex-col gap-3">
                              <div className="text-xs text-muted">各个仓数量</div>
                              {(["美西仓", "美东仓", "深圳仓"] as const)
                                .filter((f) => schema.fields.includes(f))
                                .map((f) => {
                                  const v = String(editing.data[f] ?? "");
                                  return (
                                    <div key={f} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                                      <div className="inline-flex h-10 min-w-20 items-center justify-center rounded-lg bg-surface px-3 text-sm font-semibold">
                                        {f}
                                      </div>
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        value={v}
                                        onChange={(e) => setFieldValue(f, sanitizeDecimalInput(e.target.value))}
                                        onKeyDown={(e) => {
                                          if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                        }}
                                        onWheel={(e) => {
                                          e.currentTarget.blur();
                                        }}
                                        className="h-10 flex-1 rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                      />
                                    </div>
                                  );
                                })}
                            </div>
                          </div>,
                        )}

                        {renderCard(
                          "采购成本",
                          null,
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {schema.fields.includes("采购成本总额") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">总额（¥）</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["采购成本总额"] ?? "")}
                                  onChange={(e) => setFieldValue("采购成本总额", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                            {schema.fields.includes("采购成本货物") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">货物（¥）</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["采购成本货物"] ?? "")}
                                  onChange={(e) => setFieldValue("采购成本货物", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                            {schema.fields.includes("采购成本物料") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">物料（¥）</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["采购成本物料"] ?? "")}
                                  onChange={(e) => setFieldValue("采购成本物料", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                            {schema.fields.includes("采购成本运输") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">运输（¥）</div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={String(editing.data["采购成本运输"] ?? "")}
                                  onChange={(e) => setFieldValue("采购成本运输", sanitizeDecimalInput(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                  }}
                                  onWheel={(e) => {
                                    e.currentTarget.blur();
                                  }}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "付款信息",
                          null,
                          <div className="flex flex-col gap-4">
                            {schema.fields.includes("订单金额/付款方式") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">付款账号信息</div>
                                <textarea
                                  value={String(editing.data["订单金额/付款方式"] ?? "")}
                                  onChange={(e) => setFieldValue("订单金额/付款方式", e.target.value)}
                                  className="min-h-[96px] w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none"
                                />
                              </div>
                            ) : null}

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              {schema.fields.includes("预付") ? (
                                <div className="flex flex-col gap-2">
                                  <div className="text-xs text-muted">预付（¥）</div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["预付"] ?? "")}
                                    onChange={(e) => setFieldValue("预付", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => {
                                      e.currentTarget.blur();
                                    }}
                                    className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                  />
                                </div>
                              ) : null}
                              {schema.fields.includes("尾款") ? (
                                <div className="flex flex-col gap-2">
                                  <div className="text-xs text-muted">尾款（¥）</div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={String(editing.data["尾款"] ?? "")}
                                    onChange={(e) => setFieldValue("尾款", sanitizeDecimalInput(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                    }}
                                    onWheel={(e) => {
                                      e.currentTarget.blur();
                                    }}
                                    className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                  />
                                </div>
                              ) : null}
                            </div>

                            {schema.fields.includes("阿里订单号") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">合同编号</div>
                                <input
                                  value={String(editing.data["阿里订单号"] ?? "")}
                                  onChange={(e) => setFieldValue("阿里订单号", e.target.value)}
                                  className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                                />
                              </div>
                            ) : null}

                            {schema.fields.includes("发票附件") ? (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted">发票附件</div>
                                <div className="flex items-center gap-3">
                                  <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-surface-2">
                                    <Paperclip className="h-4 w-4" />
                                    上传附件
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0] ?? null;
                                        e.currentTarget.value = "";
                                        if (!file) return;
                                        setUploadingField("发票附件");
                                        const url = await uploadImage(file);
                                        setUploadingField(null);
                                        if (!url) return;
                                        const raw = String(editing.data["发票附件"] ?? "");
                                        const existing = parseImageUrls(raw).filter(looksLikeImagePath);
                                        const next = joinImageUrls([...existing, url]);
                                        setFieldValue("发票附件", next);
                                      }}
                                      disabled={uploadingField === "发票附件"}
                                    />
                                  </label>
                                  {uploadingField === "发票附件" ? <div className="text-sm text-muted">上传中…</div> : null}
                                </div>
                                {(() => {
                                  const raw = String(editing.data["发票附件"] ?? "");
                                  const urls = parseImageUrls(raw).filter(looksLikeImagePath);
                                  if (urls.length === 0) return null;
                                  return (
                                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                      {urls.map((u, idx) => (
                                        <button
                                          key={`${u}-${idx}`}
                                          type="button"
                                          className="block"
                                          onClick={() => openImageViewer(urls, idx)}
                                        >
                                          <Image
                                            src={u}
                                            alt="发票附件"
                                            width={240}
                                            height={160}
                                            className="h-24 w-full rounded-xl border border-border bg-surface object-cover"
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : null}
                          </div>,
                        )}

                        {renderCard(
                          "发运日期",
                          null,
                          <div className="flex flex-col gap-2">
                            <div className="text-xs text-muted">发运日期</div>
                            <input
                              type="date"
                              value={String(editing.data["发运日期"] ?? "")}
                              onChange={(e) => setFieldValue("发运日期", e.target.value)}
                              className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm outline-none"
                            />
                          </div>,
                        )}
                      </div>
                    );
                  }

                  const group3 = ["预计周平均日销量", "建议采购价", "热销月份", "选品逻辑", "状态"];
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
                                <div className="text-xs text-muted sm:w-28 sm:shrink-0">平台在售价格</div>
                                <div className="flex flex-1 items-center gap-2">
                                  {fields.includes("平台在售价格模式") ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const isFixed = String(editing.data["平台在售价格模式"] ?? "") === "固定价格";
                                        const next = isFixed ? "" : "固定价格";
                                        setEditing((prev) => {
                                          if (!prev) return prev;
                                          const d: Record<string, string> = { ...prev.data, "平台在售价格模式": next };
                                          if (!isFixed) d["平台在售价格（Max）"] = "";
                                          return { ...prev, data: d };
                                        });
                                      }}
                                      className={`shrink-0 rounded border px-2 py-1 text-xs ${String(editing.data["平台在售价格模式"] ?? "") === "固定价格" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:border-primary/50"}`}
                                    >
                                      固定价格
                                    </button>
                                  ) : null}
                                  {String(editing.data["平台在售价格模式"] ?? "") === "固定价格" ? (
                                    <div className="flex-1">
                                      {fields.includes("平台在售价格（Min）") ? renderField("平台在售价格（Min）", { hideLabel: true }) : null}
                                    </div>
                                  ) : (
                                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                                      {fields.includes("平台在售价格（Min）") ? renderField("平台在售价格（Min）", { hideLabel: true }) : null}
                                      {fields.includes("平台在售价格（Max）") ? renderField("平台在售价格（Max）", { hideLabel: true }) : null}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {fields.includes("所属类目") ? <div className="sm:col-start-2">{renderField("所属类目")}</div> : null}

                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-surface p-3">
                        <div className="text-sm font-medium">规格信息</div>
                        <div className="mt-3 grid gap-3">
                          {(() => {
                            if (
                              !schema.fields.includes("产品尺寸-长（厘米）") ||
                              !schema.fields.includes("产品尺寸-宽（厘米）") ||
                              !schema.fields.includes("产品尺寸-高（厘米）")
                            ) {
                              return null;
                            }
                            const rawList = String(editing.data["产品尺寸列表"] ?? "").trim();
                            const singleL = String(editing.data["产品尺寸-长（厘米）"] ?? "").trim();
                            const singleW = String(editing.data["产品尺寸-宽（厘米）"] ?? "").trim();
                            const singleH = String(editing.data["产品尺寸-高（厘米）"] ?? "").trim();
                            let dims: { l: string; w: string; h: string }[];
                            if (rawList) {
                              const parsed = rawList.split(/[，,\r\n]+/).map((item) => {
                                const parts = item.trim().split("×");
                                return { l: (parts[0] ?? "").trim(), w: (parts[1] ?? "").trim(), h: (parts[2] ?? "").trim() };
                              });
                              dims = parsed.length > 0 ? parsed : [{ l: "", w: "", h: "" }];
                            } else if (singleL || singleW || singleH) {
                              dims = [{ l: singleL, w: singleW, h: singleH }];
                            } else {
                              dims = [{ l: "", w: "", h: "" }];
                            }
                            const updateDims = (newDims: { l: string; w: string; h: string }[]) => {
                              const list = newDims.length > 0 ? newDims : [{ l: "", w: "", h: "" }];
                              const serialized = list.map((d) => `${d.l}×${d.w}×${d.h}`).join("，");
                              setEditing((prev) => {
                                if (!prev) return prev;
                                const nextData: Record<string, string> = {
                                  ...prev.data,
                                  "产品尺寸列表": serialized,
                                  "产品尺寸-长（厘米）": list[0]?.l ?? "",
                                  "产品尺寸-宽（厘米）": list[0]?.w ?? "",
                                  "产品尺寸-高（厘米）": list[0]?.h ?? "",
                                };
                                return { ...prev, data: applyComputedFields(schema, nextData, lastMilePricing) };
                              });
                            };
                            return (
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                                <div className="text-xs text-muted sm:w-28 sm:shrink-0 sm:pt-2">产品尺寸（cm）</div>
                                <div className="flex flex-1 flex-col gap-2">
                                  {dims.map((dim, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <div className="grid flex-1 grid-cols-3 gap-2">
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          placeholder="长"
                                          value={dim.l}
                                          onChange={(e) => {
                                            const next = dims.map((d, i) => i === idx ? { ...d, l: sanitizeDecimalInput(e.target.value) } : d);
                                            updateDims(next);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                          }}
                                          onWheel={(e) => e.currentTarget.blur()}
                                          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                        />
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          placeholder="宽"
                                          value={dim.w}
                                          onChange={(e) => {
                                            const next = dims.map((d, i) => i === idx ? { ...d, w: sanitizeDecimalInput(e.target.value) } : d);
                                            updateDims(next);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                          }}
                                          onWheel={(e) => e.currentTarget.blur()}
                                          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                        />
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          placeholder="高"
                                          value={dim.h}
                                          onChange={(e) => {
                                            const next = dims.map((d, i) => i === idx ? { ...d, h: sanitizeDecimalInput(e.target.value) } : d);
                                            updateDims(next);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                          }}
                                          onWheel={(e) => e.currentTarget.blur()}
                                          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none"
                                        />
                                      </div>
                                      {dims.length > 1 ? (
                                        <button
                                          type="button"
                                          onClick={() => updateDims(dims.filter((_, i) => i !== idx))}
                                          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-red-300 hover:text-red-500"
                                        >
                                          删除
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => updateDims([...dims, { l: "", w: "", h: "" }])}
                                    className="rounded-lg border border-dashed border-border bg-surface-2 py-1.5 text-xs text-muted hover:bg-surface"
                                  >
                                    + 添加尺寸
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          {fields.includes("产品重量") ? renderField("产品重量") : null}
                          {fields.includes("产品规格") ? renderField("产品规格") : null}
                        </div>
                      </div>
                      {renderGroup("注意事项", group4, "one")}
                      {renderGroup("选品逻辑", group3, "one")}
                    </div>
                  );
                })()}
              </div>
            ) : (
            <textarea
              value={editing.data.__raw__ ?? ""}
              onCompositionStart={() => {
                editModalComposingRef.current = true;
                setIsComposing(true);
              }}
              onCompositionEnd={(e) => {
                editModalComposingRef.current = false;
                setIsComposing(false);
                setEditing((prev) => (prev ? { ...prev, data: { ...prev.data, __raw__: e.currentTarget.value } } : prev));
              }}
              onChange={(e) => {
                setEditing((prev) => (prev ? { ...prev, data: { ...prev.data, __raw__: e.target.value } } : prev));
              }}
              ref={(el) => {
                editModalFieldRefs.current["edit-__raw__"] = el;
              }}
              onFocus={() => {
                editModalLastFocusedKey.current = "edit-__raw__";
              }}
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
                className={[
                  "inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium",
                  workspaceKey === "ops.confirm"
                    ? "border-primary bg-surface text-primary hover:bg-primary hover:text-white"
                    : "border-primary bg-surface text-primary hover:bg-primary hover:text-white",
                ].join(" ")}
                onClick={() => saveEdit()}
              >
                保存
              </button>
              {workspaceKey === "ops.confirm" ? (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90"
                  onClick={() => saveEdit("待采购")}
                >
                  提交
                </button>
              ) : null}
              {workspaceKey === "ops.purchase" ? (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90"
                  onClick={() => saveEdit("待发货")}
                >
                  提交
                </button>
              ) : null}
              {workspaceKey === "ops.selection" && (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-surface px-4 text-sm font-medium text-primary hover:bg-primary hover:text-white"
                  onClick={() => saveEdit("待分配【询价】")}
                >
                  提交
                </button>
              )}
            </div>
            </div>
          );

          if (workspaceKey === "ops.inquiry") {
            const title = editing.id ? `询价修改（ID: ${editing.id}）` : "新增询价";
            return (
              <EditModalShell title={title} dataEditModal="inquiry" onClose={() => setEditing(null)}>
                {body}
              </EditModalShell>
            );
          }

          const dataEditModal =
            workspaceKey === "ops.purchase" || workspaceKey === "ops.selection" ? "purchase" : "default";
          const title =
            workspaceKey === "ops.selection"
              ? editing.id
                ? `选品修改（ID: ${editing.id}）`
                : "新增选品"
              : workspaceKey === "ops.purchase"
                ? editing.id
                  ? `采购修改（ID: ${editing.id}）`
                  : "新增采购"
                : editing.id
                  ? `修改（ID: ${editing.id}）`
                  : "新增";

          return (
            <EditModalShell title={title} dataEditModal={dataEditModal} onClose={() => setEditing(null)}>
              {body}
            </EditModalShell>
          );
        })()
      ) : null}
    </div>
  );
}
