import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { MENU_GROUPS } from "@/lib/menu/config";
import * as XLSX from "xlsx";
import { z } from "zod";
import { getWorkspaceSchema } from "@/lib/workspace/schemas";

export const runtime = "nodejs";

function isValidWorkspaceKey(key: string) {
  for (const g of MENU_GROUPS) for (const it of g.items) if (it.key === key) return true;
  return false;
}

function resolveStorageWorkspaceKey(key: string) {
  if (key === "ops.inquiry") return "ops.purchase";
  if (key === "ops.pricing") return "ops.purchase";
  return key;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const filtersRaw = url.searchParams.get("filters");

  const filtersParsed = z
    .string()
    .transform((v) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    })
    .pipe(z.record(z.string(), z.string().optional()))
    .safeParse(filtersRaw ?? "{}");

  if (!filtersParsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);
  const params: unknown[] = [storageKey];
  const where = ["workspace_key = ?", "deleted_at IS NULL"];
  if (q) {
    where.push("CAST(data AS CHAR) LIKE ?");
    params.push(`%${q}%`);
  }

  for (const [field, value] of Object.entries(filtersParsed.data)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    where.push("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) LIKE ?");
    params.push(`$."${field.replaceAll('"', '\\"')}"`);
    params.push(`%${v}%`);
  }

  const [rows] = await pool.query<
    (RowDataPacket & { id: number; updated_at: string; data: unknown })[]
  >(
    `
    SELECT id, updated_at, data
    FROM workspace_records
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT 5000
  `,
    params,
  );

  const schema = getWorkspaceSchema(key);
  const sheetRows = rows.map((r) => {
    const dataObj =
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : {};
    if (!schema) {
      return {
        id: r.id,
        updated_at: r.updated_at,
        data: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
      };
    }
    const out: Record<string, unknown> = {};
    for (const f of schema.fields) out[f] = dataObj[f] ?? "";
    return out;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, "数据");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(key)}.xlsx"`,
    },
  });
}
