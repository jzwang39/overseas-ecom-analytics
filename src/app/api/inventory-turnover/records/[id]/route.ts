import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  const recordId = Number(id);
  if (!Number.isFinite(recordId) || recordId <= 0) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM inventory_records WHERE id = ? LIMIT 1",
    [recordId],
  );
  if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });

  await pool.query<ResultSetHeader>(
    "UPDATE inventory_records SET data = CAST(? AS JSON) WHERE id = ?",
    [JSON.stringify(parsed.data.data), recordId],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "inventory.update",
    targetType: "inventory_record",
    targetId: String(recordId),
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
