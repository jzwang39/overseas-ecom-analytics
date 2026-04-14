import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { logOperation } from "@/lib/audit/log";

export const runtime = "nodejs";

function getDbErrorResponse(err: unknown) {
  if (!err || typeof err !== "object") return { status: 500, error: "数据库错误" };
  const e = err as { code?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "ER_NO_SUCH_TABLE") return { status: 500, error: "数据库未迁移：缺少 last_mile_pricing 表" };
  return { status: 500, error: "数据库错误" };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await ctx.params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      weight_lbs: z.number().positive().max(9999).nullable().optional(),
      price: z.number().nonnegative().max(99999).optional(),
      original_price: z.number().nonnegative().max(99999).nullable().optional(),
      note: z.string().max(255).nullable().optional(),
      softDelete: z.boolean().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  try {
    const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM last_mile_pricing WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [rowId],
    );
    if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (parsed.data.softDelete) {
    try {
      await pool.query<ResultSetHeader>(
        "UPDATE last_mile_pricing SET deleted_at = NOW() WHERE id = ?",
        [rowId],
      );
    } catch (err) {
      const r = getDbErrorResponse(err);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logOperation({
      req,
      actorUserId: session.user.id,
      action: "last_mile_pricing.delete",
      targetType: "last_mile_pricing",
      targetId: String(rowId),
      detail: {},
    });
    return NextResponse.json({ ok: true });
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if ("weight_lbs" in parsed.data) {
    setClauses.push("weight_lbs = ?");
    params.push(parsed.data.weight_lbs ?? null);
  }
  if (parsed.data.price !== undefined) {
    setClauses.push("price = ?");
    params.push(parsed.data.price);
  }
  if ("original_price" in parsed.data) {
    setClauses.push("original_price = ?");
    params.push(parsed.data.original_price ?? null);
  }
  if ("note" in parsed.data) {
    setClauses.push("note = ?");
    params.push(parsed.data.note ?? null);
  }

  if (setClauses.length === 0) return NextResponse.json({ ok: true });

  params.push(rowId);
  try {
    await pool.query<ResultSetHeader>(
      `UPDATE last_mile_pricing SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "last_mile_pricing.update",
    targetType: "last_mile_pricing",
    targetId: String(rowId),
    detail: { price: parsed.data.price, weight_lbs: parsed.data.weight_lbs },
  });

  return NextResponse.json({ ok: true });
}
