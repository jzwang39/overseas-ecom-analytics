import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
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
      name: string;
      description: string | null;
      menu_keys: unknown;
      created_at: string;
      updated_at: string;
    })[]
  >(
    `
    SELECT id, name, description, menu_keys, created_at, updated_at
    FROM roles
    WHERE deleted_at IS NULL
    ORDER BY id DESC
    LIMIT 200
  `,
  );

  return NextResponse.json({ roles: rows });
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
      name: z.string().min(1).max(64),
      description: z.string().max(255).optional(),
      menuKeys: z.array(z.string().min(1)).min(1),
    })
    .safeParse(body);

  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))",
    [parsed.data.name, parsed.data.description ?? null, JSON.stringify(parsed.data.menuKeys)],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "role.create",
    targetType: "role",
    targetId: String(result.insertId),
    detail: { name: parsed.data.name, menuKeysCount: parsed.data.menuKeys.length },
  });

  return NextResponse.json({ id: String(result.insertId) });
}

