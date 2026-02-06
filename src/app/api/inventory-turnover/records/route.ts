import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { hasOperationLogToday, logOperation } from "@/lib/audit/log";
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
    FROM inventory_records
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
  const parsed = z
    .union([
      z.object({
        action: z.literal("batch_copy_yesterday"),
        keepFields: z.array(z.string().min(1)).min(1).max(50),
      }),
      z.object({ data: z.record(z.string(), z.any()) }),
    ])
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  function parseJsonCell(v: unknown) {
    if (!v) return null;
    if (typeof v === "object" && !(v instanceof Buffer)) return v;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    }
    if (v instanceof Buffer) {
      try {
        return JSON.parse(v.toString("utf8")) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }

  if ("action" in parsed.data && parsed.data.action === "batch_copy_yesterday") {
    const action = "inventory.batch_copy_yesterday";
    if (await hasOperationLogToday({ action })) {
      return NextResponse.json({ error: "今日已执行过批量新增" }, { status: 409 });
    }
    const [rows] = await pool.query<(RowDataPacket & { data: unknown })[]>(
      `
      SELECT data
      FROM inventory_records
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND created_at < CURDATE()
      ORDER BY id ASC
    `,
    );

    const nextRows: Record<string, unknown>[] = [];
    for (const r of rows) {
      const raw = parseJsonCell(r.data);
      const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const out: Record<string, unknown> = {};
      for (const f of parsed.data.keepFields) out[f] = obj[f] ?? "";
      nextRows.push(out);
    }

    if (nextRows.length === 0) {
      return NextResponse.json({ inserted: 0 });
    }

    const placeholders = nextRows.map(() => "(CAST(? AS JSON))").join(", ");
    const params = nextRows.map((d) => JSON.stringify(d));
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO inventory_records(data) VALUES ${placeholders}`,
      params,
    );

    await logOperation({
      req,
      actorUserId: session.user.id,
      action,
      targetType: "inventory_record",
      targetId: null,
      detail: { inserted: result.affectedRows, keepFields: parsed.data.keepFields },
    });

    return NextResponse.json({ inserted: result.affectedRows });
  }

  if (!("data" in parsed.data)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const [result] = await pool.query<ResultSetHeader>("INSERT INTO inventory_records(data) VALUES (CAST(? AS JSON))", [
    JSON.stringify(parsed.data.data),
  ]);

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "inventory.create",
    targetType: "inventory_record",
    targetId: String(result.insertId),
    detail: null,
  });

  return NextResponse.json({ id: String(result.insertId) });
}
