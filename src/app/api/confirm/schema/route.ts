import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

export const runtime = "nodejs";

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

  const fields = await getCsvHeaderFields();
  return NextResponse.json({ fields });
}
