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

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const pool = getPool();
  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      username: string;
      display_name: string | null;
      permission_level: "super_admin" | "admin" | "user";
      role_id: number | null;
      role_name: string | null;
      is_disabled: 0 | 1;
      created_at: string;
      updated_at: string;
    })[]
  >(
    `
    SELECT
      u.id, u.username, u.display_name, u.permission_level, u.role_id,
      r.name AS role_name,
      u.is_disabled, u.created_at, u.updated_at
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL
    WHERE u.deleted_at IS NULL
    ORDER BY u.id DESC
    LIMIT 200
  `,
  );

  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      username: z.string().min(1).max(64),
      displayName: z.string().max(64).optional(),
      initialPassword: z.string().min(6).max(128),
      permissionLevel: z.enum(["super_admin", "admin", "user"]).optional(),
      roleId: z.string().optional().nullable(),
    })
    .safeParse(body);

  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const desiredLevel = parsed.data.permissionLevel ?? "user";

  if (session.user.permissionLevel === "admin" && desiredLevel !== "user") {
    return NextResponse.json({ error: "管理员只能创建使用者账号" }, { status: 403 });
  }

  const pool = getPool();
  const passwordHash = await hashPassword(parsed.data.initialPassword);

  const roleIdNumber = parsed.data.roleId ? Number(parsed.data.roleId) : null;

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, ?, ?)",
    [parsed.data.username, parsed.data.displayName ?? null, passwordHash, desiredLevel, roleIdNumber],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "user.create",
    targetType: "user",
    targetId: String(result.insertId),
    detail: { username: parsed.data.username, permissionLevel: desiredLevel, roleId: roleIdNumber },
  });

  return NextResponse.json({ id: String(result.insertId) });
}

