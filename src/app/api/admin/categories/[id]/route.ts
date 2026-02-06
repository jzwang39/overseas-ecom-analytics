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
  if (code === "ER_NO_SUCH_TABLE") return { status: 500, error: "数据库未迁移：缺少 categories 表" };
  if (code === "ER_DUP_ENTRY") return { status: 409, error: "类目已存在" };
  return { status: 500, error: "数据库错误" };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await ctx.params;
  const categoryId = Number(id);
  if (!Number.isFinite(categoryId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      name: z.string().min(1).max(128).optional(),
      softDelete: z.boolean().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  try {
    const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [categoryId],
    );
    if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (parsed.data.softDelete) {
    try {
      await pool.query<ResultSetHeader>("UPDATE categories SET deleted_at = NOW() WHERE id = ?", [categoryId]);
    } catch (err) {
      const r = getDbErrorResponse(err);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logOperation({
      req,
      actorUserId: session.user.id,
      action: "category.delete",
      targetType: "category",
      targetId: String(categoryId),
      detail: {},
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.name) {
    try {
      await pool.query<ResultSetHeader>("UPDATE categories SET name = ? WHERE id = ?", [
        parsed.data.name,
        categoryId,
      ]);
    } catch (err) {
      const r = getDbErrorResponse(err);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logOperation({
      req,
      actorUserId: session.user.id,
      action: "category.update",
      targetType: "category",
      targetId: String(categoryId),
      detail: { name: parsed.data.name },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
