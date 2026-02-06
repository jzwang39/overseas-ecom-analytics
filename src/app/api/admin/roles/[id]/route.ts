import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { logOperation } from "@/lib/audit/log";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await ctx.params;
  const roleId = Number(id);
  if (!Number.isFinite(roleId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      name: z.string().min(1).max(64).optional(),
      description: z.string().max(255).nullable().optional(),
      menuKeys: z.array(z.string().min(1)).optional(),
      softDelete: z.boolean().optional(),
    })
    .safeParse(body);

  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [roleId],
  );
  if (existing.length === 0) return NextResponse.json({ error: "角色不存在" }, { status: 404 });

  const updates: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.name) {
    updates.push("name = ?");
    params.push(parsed.data.name);
  }
  if (parsed.data.description !== undefined) {
    updates.push("description = ?");
    params.push(parsed.data.description ?? null);
  }
  if (parsed.data.menuKeys) {
    updates.push("menu_keys = CAST(? AS JSON)");
    params.push(JSON.stringify(parsed.data.menuKeys));
  }
  if (parsed.data.softDelete) {
    updates.push("deleted_at = ?");
    params.push(new Date());
  }

  if (updates.length === 0) return NextResponse.json({ ok: true });

  params.push(roleId);
  await pool.query<ResultSetHeader>(`UPDATE roles SET ${updates.join(", ")} WHERE id = ?`, params);

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "role.update",
    targetType: "role",
    targetId: String(roleId),
    detail: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
