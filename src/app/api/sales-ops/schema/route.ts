import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

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

function resolveCsvPath() {
  const filename = "至繁运营管理表_运营链接日常跟踪表_表格.csv";
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

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fields = await getCsvHeaderFields();
  return NextResponse.json({ fields });
}
