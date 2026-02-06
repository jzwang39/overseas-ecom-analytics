import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { MENU_GROUPS } from "@/lib/menu/config";
import { logOperation } from "@/lib/audit/log";
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

function todayYmd() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function normalizeWorkspaceData(workspaceKey: string, input: Record<string, unknown>, mode: "create" | "update") {
  if (!getWorkspaceSchema(workspaceKey)) return input;
  const out: Record<string, unknown> = { ...input };
  if (mode === "create" && !out["创建时间"]) out["创建时间"] = todayYmd();
  if (mode === "create") out["最后更新时间"] = null;
  else out["最后更新时间"] = todayYmd();
  if (!out["状态"]) out["状态"] = "进行中";
  return out;
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
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "50")));

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

  params.push(limit);

  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      data: unknown;
      updated_at: string;
    })[]
  >(
    `
    SELECT id, data, updated_at
    FROM workspace_records
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT ?
  `,
    params,
  );

  return NextResponse.json({ records: rows });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeWorkspaceData(key, parsed.data.data, "create");
  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO workspace_records(workspace_key, data) VALUES (?, CAST(? AS JSON))",
    [storageKey, JSON.stringify(normalized)],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "workspace.create",
    targetType: "workspace_record",
    targetId: String(result.insertId),
    detail: { workspaceKey: key },
  });

  return NextResponse.json({ id: String(result.insertId) });
}
