import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

const FALLBACK_FIELDS = ["运营人员", "店铺名称", "产品名称", "SKC", "SKU", "产品规格", "链接标签"];

function normalizeHeaderCell(v: string) {
  return v.replaceAll("\r", "").replaceAll("\n", "").replace(/\s+/g, " ").trim();
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

function parseJsonCell(v: unknown) {
  if (!v) return null;
  if (typeof v === "object" && !(v instanceof Buffer)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (v instanceof Buffer) {
    try {
      return JSON.parse(v.toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

async function getFieldsFromRecentRecords() {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { data: unknown })[]>(
    "SELECT data FROM purchase_records ORDER BY id DESC LIMIT 50",
  );
  if (rows.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const raw = parseJsonCell(r.data);
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }

  return out;
}

function resolveCsvPath() {
  const candidates = [
    path.join(process.cwd(), "..", "SkyNest订货明细2025.csv"),
    path.join(process.cwd(), "SkyNest订货明细2025.csv"),
  ];
  return candidates;
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

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fromCsv = await getCsvHeaderFields();
  if (fromCsv.length > 0) return NextResponse.json({ fields: fromCsv });

  const fromDb = await getFieldsFromRecentRecords();
  const fields = fromDb.length > 0 ? fromDb : FALLBACK_FIELDS;
  return NextResponse.json({ fields });
}
