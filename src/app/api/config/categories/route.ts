import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

function getDbErrorResponse(err: unknown) {
  if (!err || typeof err !== "object") return { status: 500, error: "数据库错误" };
  const e = err as { code?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "ER_NO_SUCH_TABLE") return { status: 500, error: "数据库未迁移：缺少 categories 表" };
  return { status: 500, error: "数据库错误" };
}

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { id: number; name: string })[]>(
      `
      SELECT id, name
      FROM categories
      WHERE deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1000
    `,
    );
    return NextResponse.json({ categories: rows });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
