import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { hashPassword } from "@/lib/security/password";
import { logOperation } from "@/lib/audit/log";

export const runtime = "nodejs";

async function countOtherSuperAdmins(targetId: number) {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { cnt: number })[]>(
    "SELECT COUNT(1) AS cnt FROM users WHERE permission_level = 'super_admin' AND deleted_at IS NULL AND id <> ?",
    [targetId],
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isFinite(targetId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      isDisabled: z.boolean().optional(),
      permissionLevel: z.enum(["super_admin", "admin", "user"]).optional(),
      roleId: z.string().nullable().optional(),
      resetPassword: z.string().min(6).max(128).optional(),
      softDelete: z.boolean().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const [targetRows] = await pool.query<
    (RowDataPacket & {
      id: number;
      username: string;
      permission_level: "super_admin" | "admin" | "user";
      is_disabled: 0 | 1;
    })[]
  >(
    "SELECT id, username, permission_level, is_disabled FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [targetId],
  );
  const target = targetRows[0];
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  if (session.user.permissionLevel === "admin") {
    if (target.permission_level !== "user") {
      return NextResponse.json({ error: "管理员不能修改该用户" }, { status: 403 });
    }
    if (parsed.data.permissionLevel === "super_admin") {
      return NextResponse.json({ error: "管理员不能设置超级管理员" }, { status: 403 });
    }
  }

  if (target.permission_level === "super_admin") {
    if (parsed.data.permissionLevel && parsed.data.permissionLevel !== "super_admin") {
      const others = await countOtherSuperAdmins(targetId);
      if (others <= 0) {
        return NextResponse.json({ error: "必须保留至少一个超级管理员" }, { status: 400 });
      }
    }
    if (parsed.data.softDelete) {
      const others = await countOtherSuperAdmins(targetId);
      if (others <= 0) {
        return NextResponse.json({ error: "必须保留至少一个超级管理员" }, { status: 400 });
      }
    }
    if (parsed.data.isDisabled === true) {
      const others = await countOtherSuperAdmins(targetId);
      if (others <= 0) {
        return NextResponse.json({ error: "必须保留至少一个超级管理员" }, { status: 400 });
      }
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof parsed.data.isDisabled === "boolean") {
    updates.push("is_disabled = ?");
    params.push(parsed.data.isDisabled ? 1 : 0);
    updates.push("disabled_at = ?");
    params.push(parsed.data.isDisabled ? new Date() : null);
  }

  if (parsed.data.permissionLevel) {
    updates.push("permission_level = ?");
    params.push(parsed.data.permissionLevel);
  }

  if (parsed.data.roleId !== undefined) {
    updates.push("role_id = ?");
    params.push(parsed.data.roleId ? Number(parsed.data.roleId) : null);
  }

  if (parsed.data.resetPassword) {
    const passwordHash = await hashPassword(parsed.data.resetPassword);
    updates.push("password_hash = ?");
    params.push(passwordHash);
  }

  if (parsed.data.softDelete) {
    updates.push("deleted_at = ?");
    params.push(new Date());
  }

  if (updates.length === 0) return NextResponse.json({ ok: true });

  params.push(targetId);
  await pool.query<ResultSetHeader>(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "user.update",
    targetType: "user",
    targetId: String(targetId),
    detail: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
