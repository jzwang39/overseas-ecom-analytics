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

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user") return NextResponse.json({ error: "无权限" }, { status: 403 });

  try {
    const pool = getPool();
    const [rows] = await pool.query<
      (RowDataPacket & { id: number; name: string; created_at: string; updated_at: string })[]
    >(
      `
      SELECT id, name, created_at, updated_at
      FROM categories
      WHERE deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 500
    `,
    );
    return NextResponse.json({ categories: rows });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}

export async function POST(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ name: z.string().min(1).max(128) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  let result: ResultSetHeader;
  try {
    const pool = getPool();
    const [r] = await pool.query<ResultSetHeader>("INSERT INTO categories(name) VALUES (?)", [
      parsed.data.name,
    ]);
    result = r;
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "category.create",
    targetType: "category",
    targetId: String(result.insertId),
    detail: { name: parsed.data.name },
  });

  return NextResponse.json({ id: String(result.insertId) });
}
