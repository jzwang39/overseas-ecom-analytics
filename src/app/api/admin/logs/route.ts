import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const url = new URL(req.url);
  const parsed = z
    .object({
      action: z.string().optional(),
      actor: z.string().optional(),
      limit: z
        .string()
        .optional()
        .transform((v) => Number(v ?? "100")),
    })
    .safeParse({
      action: url.searchParams.get("action") ?? undefined,
      actor: url.searchParams.get("actor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const limit = Math.max(1, Math.min(200, parsed.data.limit));
  const where: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.action) {
    where.push("l.action = ?");
    params.push(parsed.data.action);
  }
  if (parsed.data.actor) {
    where.push("u.username = ?");
    params.push(parsed.data.actor);
  }

  const pool = getPool();
  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: unknown;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
      actor_username: string | null;
    })[]
  >(
    `
    SELECT
      l.id, l.action, l.target_type, l.target_id, l.detail, l.ip, l.user_agent, l.created_at,
      u.username AS actor_username
    FROM operation_logs l
    LEFT JOIN users u ON u.id = l.actor_user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY l.id DESC
    LIMIT ?
  `,
    [...params, limit],
  );

  return NextResponse.json({ logs: rows });
}

