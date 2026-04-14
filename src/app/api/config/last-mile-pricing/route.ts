import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { weight_lbs: string | null; price: string })[]>(
      `SELECT weight_lbs, price
       FROM last_mile_pricing
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC
       LIMIT 2000`,
    );
    return NextResponse.json({ rows });
  } catch (err) {
    const e = err as { code?: unknown };
    const code = typeof e?.code === "string" ? e.code : "";
    if (code === "ER_NO_SUCH_TABLE") return NextResponse.json({ rows: [] });
    return NextResponse.json({ error: "数据库错误" }, { status: 500 });
  }
}
