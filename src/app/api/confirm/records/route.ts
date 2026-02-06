import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

export async function GET(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const filtersRaw = url.searchParams.get("filters");
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "50")));

  const filtersParsed = z
    .string()
    .transform((v) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    })
    .pipe(z.record(z.string(), z.string().optional()))
    .safeParse(filtersRaw ?? "{}");

  if (!filtersParsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const params: unknown[] = [];
  const where = ["1 = 1"];

  if (q) {
    where.push("CAST(data AS CHAR) LIKE ?");
    params.push(`%${q}%`);
  }

  for (const [field, value] of Object.entries(filtersParsed.data)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    where.push("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) LIKE ?");
    params.push(`$."${field.replaceAll('"', '\\"')}"`);
    params.push(`%${v}%`);
  }

  params.push(limit);

  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      data: unknown;
      updated_at: string;
    })[]
  >(
    `
    SELECT id, data, updated_at
    FROM purchase_records
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT ?
  `,
    params,
  );

  return NextResponse.json({ records: rows });
}

export async function POST(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ id: z.number().int().positive(), data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  try {
    await pool.query<ResultSetHeader>(
      "INSERT INTO purchase_records(id, data) VALUES (?, CAST(? AS JSON))",
      [parsed.data.id, JSON.stringify(parsed.data.data)],
    );
  } catch {
    return NextResponse.json({ error: "已存在" }, { status: 409 });
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "purchase.create",
    targetType: "purchase_record",
    targetId: String(parsed.data.id),
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
