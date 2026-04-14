const CM_TO_IN = 0.3937;
const KG_TO_LB = 2.2;

/** A single row from the last_mile_pricing table used for dispatch-fee lookup. */
export type PricingEntry = { weight_lbs: number | null; price: number };

/**
 * Look up the last-mile dispatch fee (USD) for a given billed weight in kg.
 *
 * Conversion: 1 kg = 2.2046 lbs, rounded to 2 decimal places.
 * Lookup key: exact decimal for < 1 lb; ceiling to nearest integer for >= 1 lb.
 */
export function lookupDispatchFeeUsd(
  pricingTable: PricingEntry[],
  billedWeightKg: number,
): number | null {
  if (billedWeightKg <= 0 || pricingTable.length === 0) return null;
  const lbs = Math.round(billedWeightKg * 2.2046 * 100) / 100;
  if (lbs <= 0) return null;
  const lookupKey = lbs < 1 ? lbs : Math.ceil(lbs);
  const entry = pricingTable.find(
    (e) => e.weight_lbs != null && Math.abs(e.weight_lbs - lookupKey) < 0.005,
  );
  return entry != null ? entry.price : null;
}

function toFiniteNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatDecimal(n: number, digits = 4): string {
  const s = n.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function ceilToMultiple(n: number, step: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (!Number.isFinite(step) || step <= 0) return null;
  return Math.ceil(n / step) * step;
}

/**
 * Apply all computed fields to a flat string record.
 *
 * Rules applied (in order):
 * 1. 包裹体积（立方厘米）= 包裹尺寸-长 × 宽 × 高
 * 2. 运输包装体积 = 运输包装尺寸-长 × 宽 × 高
 * 3. cm → inch conversions for matching field pairs
 * 4. DIVIDE rules (体积重, 运输包装体积重)
 * 5. MAX rules (包裹计费重, 运输包装计费重)
 * 6. MULTIPLIER_CEIL rules (包裹计费重（磅）)
 * 7. SUM_MULTIPLY rules (尾程成本（人民币）)
 * 8. SUM_MULTIPLY_CONST rules (成本总计, 负向成本)
 * 9. MULTIPLY_CONST rules (人民币报价)
 * 10. DIVIDE_CONST rules (temu pricing)
 *
 * Defaults applied before computation:
 *   体积重系数 = 6000 (if not set)
 *   运输包装体积系数 = 6000 (if not set)
 */
export function applyComputedFields(
  schema: { fields: string[] },
  data: Record<string, string>,
  pricingTable: PricingEntry[] = [],
): Record<string, string> {
  const out: Record<string, string> = { ...data };

  // Apply defaults
  if (schema.fields.includes("体积重系数") && !out["体积重系数"]) out["体积重系数"] = "6000";
  if (schema.fields.includes("运输包装体积系数") && !out["运输包装体积系数"]) out["运输包装体积系数"] = "6000";

  // 1. 包裹体积（立方厘米）= L × W × H
  if (
    schema.fields.includes("包裹体积（立方厘米）") &&
    schema.fields.includes("包裹尺寸-长（厘米）") &&
    schema.fields.includes("包裹尺寸-宽（厘米）") &&
    schema.fields.includes("包裹尺寸-高（厘米）")
  ) {
    const l = toFiniteNumber(out["包裹尺寸-长（厘米）"] ?? "");
    const w = toFiniteNumber(out["包裹尺寸-宽（厘米）"] ?? "");
    const h = toFiniteNumber(out["包裹尺寸-高（厘米）"] ?? "");
    if (l != null && w != null && h != null) {
      out["包裹体积（立方厘米）"] = formatDecimal(l * w * h, 4);
    }
  }

  // 2. 运输包装体积 = L × W × H
  if (
    schema.fields.includes("运输包装体积") &&
    schema.fields.includes("运输包装尺寸-长（厘米）") &&
    schema.fields.includes("运输包装尺寸-宽（厘米）") &&
    schema.fields.includes("运输包装尺寸-高（厘米）")
  ) {
    const l = toFiniteNumber(out["运输包装尺寸-长（厘米）"] ?? "");
    const w = toFiniteNumber(out["运输包装尺寸-宽（厘米）"] ?? "");
    const h = toFiniteNumber(out["运输包装尺寸-高（厘米）"] ?? "");
    if (l != null && w != null && h != null) {
      out["运输包装体积"] = formatDecimal(l * w * h, 4);
    }
  }

  // 3. cm → inch conversions
  const cmToInMap: Array<{ cm: string; inch: string }> = [
    { cm: "包裹尺寸-长（厘米）", inch: "包裹尺寸-长（英寸）" },
    { cm: "包裹尺寸-宽（厘米）", inch: "包裹尺寸-宽（英寸）" },
    { cm: "包裹尺寸-高（厘米）", inch: "包裹尺寸-高（英寸）" },
    { cm: "产品尺寸-长（厘米）", inch: "包装尺寸-长（英寸）" },
    { cm: "产品尺寸-宽（厘米）", inch: "包装尺寸-宽（英寸）" },
    { cm: "产品尺寸-高（厘米）", inch: "包装尺寸-高（英寸）" },
  ];
  for (const { cm, inch } of cmToInMap) {
    if (!schema.fields.includes(inch)) continue;
    const raw = out[cm] ?? "";
    const v = toFiniteNumber(raw);
    if (v != null) out[inch] = formatDecimal(v * CM_TO_IN, 4);
  }

  // 4. DIVIDE rules
  const divideRules = [
    { target: "体积重", numerator: "包裹体积（立方厘米）", denominator: "体积重系数", digits: 4 },
    { target: "运输包装体积重", numerator: "运输包装体积", denominator: "运输包装体积系数", digits: 4 },
  ] as const;
  for (const r of divideRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.numerator)) continue;
    if (!schema.fields.includes(r.denominator)) continue;
    const a = toFiniteNumber(out[r.numerator] ?? "");
    const b = toFiniteNumber(out[r.denominator] ?? "");
    if (a == null || b == null || b === 0) continue;
    out[r.target] = formatDecimal(a / b, r.digits);
  }

  // 5. MAX rules
  const maxRules = [
    { target: "包裹计费重", a: "体积重", b: "包裹实重（公斤）" },
    { target: "运输包装计费重", a: "运输包装体积重", b: "运输包装实重" },
  ] as const;
  for (const r of maxRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.a)) continue;
    if (!schema.fields.includes(r.b)) continue;
    const a = toFiniteNumber(out[r.a] ?? "");
    const b = toFiniteNumber(out[r.b] ?? "");
    if (a == null && b == null) {
      /* keep existing */
    } else if (a == null) {
      out[r.target] = formatDecimal(b!, 4);
    } else if (b == null) {
      out[r.target] = formatDecimal(a, 4);
    } else {
      out[r.target] = formatDecimal(Math.max(a, b), 4);
    }
  }

  // 5.5. Auto-compute 派送费（需要测试？）from last-mile pricing table
  if (
    pricingTable.length > 0 &&
    schema.fields.includes("派送费（需要测试？）") &&
    schema.fields.includes("包裹计费重")
  ) {
    const billedKg = toFiniteNumber(out["包裹计费重"] ?? "");
    if (billedKg != null && billedKg > 0) {
      const feeUsd = lookupDispatchFeeUsd(pricingTable, billedKg);
      if (feeUsd != null) out["派送费（需要测试？）"] = formatDecimal(feeUsd, 4);
    }
  }

  // 6. MULTIPLIER_CEIL rules
  const multiplierCeilRules = [{ target: "包裹计费重（磅）", source: "包裹计费重", factor: KG_TO_LB, step: 1 }] as const;
  for (const r of multiplierCeilRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    const v = toFiniteNumber(out[r.source] ?? "");
    if (v == null) continue;
    const result = ceilToMultiple(v * r.factor, r.step);
    if (result == null) continue;
    out[r.target] = r.step === 1 ? String(result) : formatDecimal(result, 4);
  }

  // 7. SUM_MULTIPLY rules (尾程成本（人民币）)
  const sumMultiplyRules = [
    {
      target: "尾程成本（人民币）",
      addends: ["海外仓（卸货费）", "海外仓（操作费）", "派送费（需要测试？）"] as string[],
      factor: "美元汇率",
      digits: 4,
    },
  ] as const;
  for (const r of sumMultiplyRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.factor)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) { ok = false; break; }
    if (!ok) continue;
    const factor = toFiniteNumber(out[r.factor] ?? "");
    if (factor == null) continue;
    let any = false;
    let sum = 0;
    for (const f of r.addends) {
      const v = toFiniteNumber(out[f] ?? "");
      if (v == null) continue;
      any = true;
      sum += v;
    }
    if (any) out[r.target] = formatDecimal(sum * factor, r.digits);
  }

  // 8. SUM_MULTIPLY_CONST rules (成本总计, 负向成本)
  const sumMultiplyConstRules = [
    { target: "成本总计", addends: ["采购成本", "头程成本", "尾程成本（人民币）"] as string[], factor: 1, digits: 4 },
    { target: "负向成本", addends: ["头程成本", "采购成本", "尾程成本（人民币）"] as string[], factor: 0.1, digits: 4 },
  ] as const;
  for (const r of sumMultiplyConstRules) {
    if (!schema.fields.includes(r.target)) continue;
    let ok = true;
    for (const f of r.addends) if (!schema.fields.includes(f)) { ok = false; break; }
    if (!ok) continue;
    let any = false;
    let sum = 0;
    for (const f of r.addends) {
      const v = toFiniteNumber(out[f] ?? "");
      if (v == null) continue;
      any = true;
      sum += v;
    }
    if (any) out[r.target] = formatDecimal(sum * r.factor, r.digits);
  }

  // 9. MULTIPLY_CONST rules (人民币报价)
  const multiplyConstRules = [{ target: "人民币报价", source: "成本总计", factor: 1.2, digits: 4 }] as const;
  for (const r of multiplyConstRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    const v = toFiniteNumber(out[r.source] ?? "");
    if (v == null) continue;
    out[r.target] = formatDecimal(v * r.factor, r.digits);
  }

  // 10. DIVIDE_CONST rules (temu pricing)
  const divideConstRules = [
    { target: "temu核价最低标准（未加2.99）", source: "成本总计", divisor: 0.6, digits: 4 },
    { target: "temu报价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 4 },
    { target: "temu售价", source: "temu核价最低标准（未加2.99）", divisor: 0.6, digits: 4 },
  ] as const;
  for (const r of divideConstRules) {
    if (!schema.fields.includes(r.target)) continue;
    if (!schema.fields.includes(r.source)) continue;
    const v = toFiniteNumber(out[r.source] ?? "");
    if (v == null || v === 0) continue;
    out[r.target] = formatDecimal(v / r.divisor, r.digits);
  }

  return out;
}
