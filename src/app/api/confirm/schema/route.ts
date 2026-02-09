import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { SKYNEST_PURCHASE_FIELDS_2025 } from "@/lib/workspace/schemas";

export const runtime = "nodejs";

const RECORD_TYPE = "purchase";

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
  const filename = "SkyNest订货明细2025.csv";
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

  const records = parseCsvRecords(raw, 2);
  const h1 = records[0] ?? [];
  const h2 = records[1] ?? [];
  const maxLen = Math.max(h1.length, h2.length);
  const out: string[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < maxLen; i++) {
    const a = normalizeHeaderCell(String(h1[i] ?? ""));
    const b = normalizeHeaderCell(String(h2[i] ?? ""));
    let name = "";
    if (!a) name = b;
    else if (!b) name = a;
    else if (a === b) name = a;
    else name = `${a}-${b}`;

    name = normalizeHeaderCell(name);
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
  try {
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
  } catch {
    return [];
  }
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
  await saveFieldsToRecordDefs(SKYNEST_PURCHASE_FIELDS_2025);
  const fields = SKYNEST_PURCHASE_FIELDS_2025;
  return NextResponse.json({ fields });
}
