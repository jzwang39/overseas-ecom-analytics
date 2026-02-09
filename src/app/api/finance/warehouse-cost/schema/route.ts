import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

const RECORD_TYPE = "warehouse_cost";

export const runtime = "nodejs";

const WAREHOUSE_COST_FIELDS: string[] = [
  "仓库名称",
  "客户",
  "单据类型",
  "单号",
  "ERP单号",
  "运单号",
  "平台订单号",
  "计费时间",
  "流水号",
  "费用项",
  "计费策略",
  "货币",
  "计费金额",
  "核销节点",
  "核销状态",
  "出账状态",
  "关联账单",
  "账单状态",
  "货主",
];

function normalizeHeaderCell(v: string) {
  const s = v.replaceAll("\r", "").replaceAll("\n", "").replace(/\s+/g, " ").trim();
  return s.startsWith("\uFEFF") ? s.slice(1) : s;
}

function parseCsvRecords(input: string, maxRecords: number) {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '"') {
      if (inQuotes && input[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === ",") {
      pushField();
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      pushRow();
      if (records.length >= maxRecords) break;
      continue;
    }

    field += ch;
  }

  if (records.length < maxRecords && (field.length > 0 || row.length > 0)) {
    pushRow();
  }

  return records;
}

function resolveCsvPath() {
  const filename = "fee_Detail_20251218103822435192__全部费用.csv";
  return [path.join(process.cwd(), "..", filename), path.join(process.cwd(), filename)];
}

async function getCsvHeaderFields() {
  const candidates = resolveCsvPath();
  let raw: string | null = null;
  for (const p of candidates) {
    try {
      raw = await fs.readFile(p, "utf8");
      break;
    } catch {}
  }
  if (!raw) return [];

  const records = parseCsvRecords(raw, 1);
  const header = records[0] ?? [];
  const out: string[] = [];
  const seen = new Map<string, number>();

  for (const cell of header) {
    const name = normalizeHeaderCell(String(cell ?? ""));
    if (!name) continue;
    const c = (seen.get(name) ?? 0) + 1;
    seen.set(name, c);
    if (c === 1) out.push(name);
    else out.push(`${name}（${c}）`);
  }

  return out;
}

async function getFieldsFromRecordDefs() {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { field_key: string })[]>(
    `
    SELECT field_key
    FROM record_field_defs
    WHERE record_type = ?
    ORDER BY (sort_order IS NULL) ASC, sort_order ASC, field_key ASC
  `,
    [RECORD_TYPE],
  );
  return rows.map((r) => r.field_key);
}

async function saveFieldsToRecordDefs(fields: string[]) {
  if (fields.length === 0) return;
  const pool = getPool();
  const placeholders = fields.map(() => "(?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (let i = 0; i < fields.length; i++) params.push(RECORD_TYPE, fields[i], i + 1);
  try {
    await pool.query<ResultSetHeader>(
      `
      INSERT IGNORE INTO record_field_defs(record_type, field_key, sort_order)
      VALUES ${placeholders}
    `,
      params,
    );
  } catch {}
}

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fromDefs = await getFieldsFromRecordDefs();
  if (fromDefs.length > 0) return NextResponse.json({ fields: fromDefs });

  const fromCsv = await getCsvHeaderFields();
  if (fromCsv.length > 0) {
    await saveFieldsToRecordDefs(fromCsv);
    return NextResponse.json({ fields: fromCsv });
  }

  await saveFieldsToRecordDefs(WAREHOUSE_COST_FIELDS);
  return NextResponse.json({ fields: WAREHOUSE_COST_FIELDS });
}
