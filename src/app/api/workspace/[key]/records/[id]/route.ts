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

function normalizeWorkspaceData(workspaceKey: string, input: Record<string, unknown>) {
  if (!getWorkspaceSchema(workspaceKey)) return input;
  const out: Record<string, unknown> = { ...input };
  out["最后更新时间"] = todayYmd();
  if (!out["状态"]) out["状态"] = "进行中";
  return out;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ key: string; id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key, id } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const recordId = Number(id);
  if (!Number.isFinite(recordId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeWorkspaceData(key, parsed.data.data);
  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
    [recordId, storageKey],
  );
  if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });

  await pool.query<ResultSetHeader>(
    "UPDATE workspace_records SET data = CAST(? AS JSON) WHERE id = ?",
    [JSON.stringify(normalized), recordId],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "workspace.update",
    targetType: "workspace_record",
    targetId: String(recordId),
    detail: { workspaceKey: key },
  });

  return NextResponse.json({ ok: true });
}
