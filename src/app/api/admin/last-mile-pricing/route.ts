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

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.permissionLevel === "user") return NextResponse.json({ error: "无权限" }, { status: 403 });

  try {
    const pool = getPool();
    const [rows] = await pool.query<
      (RowDataPacket & {
        id: number;
        weight_lbs: string | null;
        price: string;
        original_price: string | null;
        sort_order: number;
        note: string | null;
        updated_at: string;
      })[]
    >(
      `SELECT id, weight_lbs, price, original_price, sort_order, note, updated_at
       FROM last_mile_pricing
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, id ASC
       LIMIT 2000`,
    );
    return NextResponse.json({ rows });
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
  const parsed = z
    .object({
      weight_lbs: z.number().positive().max(9999).nullable().optional(),
      price: z.number().nonnegative().max(99999),
      original_price: z.number().nonnegative().max(99999).nullable().optional(),
      note: z.string().max(255).nullable().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  try {
    const pool = getPool();
    // sort_order: append after current max
    const [maxRow] = await pool.query<(RowDataPacket & { max_order: number | null })[]>(
      "SELECT MAX(sort_order) AS max_order FROM last_mile_pricing WHERE deleted_at IS NULL",
    );
    const nextOrder = (maxRow[0]?.max_order ?? 0) + 1;

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO last_mile_pricing (weight_lbs, price, original_price, sort_order, note) VALUES (?, ?, ?, ?, ?)",
      [
        parsed.data.weight_lbs ?? null,
        parsed.data.price,
        parsed.data.original_price ?? null,
        nextOrder,
        parsed.data.note ?? null,
      ],
    );

    await logOperation({
      req,
      actorUserId: session.user.id,
      action: "last_mile_pricing.create",
      targetType: "last_mile_pricing",
      targetId: String(result.insertId),
      detail: { weight_lbs: parsed.data.weight_lbs, price: parsed.data.price },
    });

    return NextResponse.json({ id: String(result.insertId) });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
