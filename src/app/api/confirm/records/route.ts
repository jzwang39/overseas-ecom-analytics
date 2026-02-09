import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { SKYNEST_PURCHASE_FIELDS_2025 } from "@/lib/workspace/schemas";

const RECORD_TYPE = "purchase";

async function getFieldsFromRecordDefs() {
  const pool = getPool();
  try {
    const [rows] = await pool.query<(RowDataPacket & { field_key: string })[]>(
      `
      SELECT field_key
      FROM record_field_defs
      WHERE record_type = ?
      ORDER BY (sort_order IS NULL) ASC, sort_order ASC, field_key ASC
    `,
      [RECORD_TYPE],
    );
    return rows.map((r) => r.field_key);
  } catch {
    return [];
  }
}

async function getFieldsFromRecordFields() {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { field_key: string })[]>(
    `
    SELECT field_key
    FROM purchase_record_fields
    GROUP BY field_key
    ORDER BY field_key ASC
    LIMIT 1000
  `,
  );
  return rows.map((r) => r.field_key);
}

let cachedPurchaseFields: string[] | null = null;
let cachedPurchaseFieldsAt = 0;
async function getPurchaseFields() {
  const now = Date.now();
  if (cachedPurchaseFields && now - cachedPurchaseFieldsAt < 3000) return cachedPurchaseFields;
  const fromDefs = await getFieldsFromRecordDefs();
  if (fromDefs.length > 0) {
    cachedPurchaseFields = fromDefs;
  } else {
    const fromFields = await getFieldsFromRecordFields();
    cachedPurchaseFields = fromFields.length > 0 ? fromFields : SKYNEST_PURCHASE_FIELDS_2025;
  }
  cachedPurchaseFieldsAt = now;
  return cachedPurchaseFields;
}

function normalizeData(input: Record<string, unknown>, fields: string[]) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f];
    out[f] = v == null ? "" : String(v);
  }
  return out;
}

async function loadRecordDataByIds(ids: number[]) {
  if (ids.length === 0) return new Map<number, Record<string, unknown>>();
  const pool = getPool();
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.query<
    (RowDataPacket & {
      purchase_record_id: number;
      field_key: string;
      field_value: string | null;
    })[]
  >(
    `
    SELECT purchase_record_id, field_key, field_value
    FROM purchase_record_fields
    WHERE purchase_record_id IN (${placeholders})
  `,
    ids,
  );
  const out = new Map<number, Record<string, unknown>>();
  for (const id of ids) out.set(id, {});
  for (const r of rows) {
    const obj = out.get(r.purchase_record_id);
    if (!obj) continue;
    obj[r.field_key] = r.field_value ?? "";
  }
  return out;
}

async function upsertRecordFields(
  conn: PoolConnection,
  recordId: number,
  data: Record<string, string>,
  allowedFields: Set<string>,
) {
  const entries: Array<[string, string]> = [];
  const emptyKeys: string[] = [];
  for (const [k, vRaw] of Object.entries(data)) {
    if (!allowedFields.has(k)) continue;
    const v = vRaw.trim();
    if (!v) emptyKeys.push(k);
    else entries.push([k, v]);
  }

  if (emptyKeys.length) {
    const placeholders = emptyKeys.map(() => "?").join(", ");
    await conn.query<ResultSetHeader>(
      `DELETE FROM purchase_record_fields WHERE purchase_record_id = ? AND field_key IN (${placeholders})`,
      [recordId, ...emptyKeys],
    );
  }

  if (entries.length) {
    const placeholders = entries.map(() => "(?, ?, ?)").join(", ");
    const params: unknown[] = [];
    for (const [k, v] of entries) params.push(recordId, k, v);
    await conn.query<ResultSetHeader>(
      `
      INSERT INTO purchase_record_fields(purchase_record_id, field_key, field_value)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)
    `,
      params,
    );
  }
}

export async function GET(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fields = await getPurchaseFields();
  const allowedFields = new Set(fields);

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
  const where: string[] = ["1 = 1"];

  if (q) {
    where.push(
      `
      EXISTS (
        SELECT 1
        FROM purchase_record_fields kv
        WHERE kv.purchase_record_id = r.id
          AND kv.field_value LIKE ?
      )
    `,
    );
    params.push(`%${q}%`);
  }

  for (const [field, value] of Object.entries(filtersParsed.data)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    if (!allowedFields.has(field)) continue;
    where.push(
      `
      EXISTS (
        SELECT 1
        FROM purchase_record_fields kv
        WHERE kv.purchase_record_id = r.id
          AND kv.field_key = ?
          AND kv.field_value LIKE ?
      )
    `,
    );
    params.push(field, `%${v}%`);
  }

  params.push(limit);

  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      updated_at: string;
    })[]
  >(
    `
    SELECT r.id, r.updated_at
    FROM purchase_records r
    WHERE ${where.join(" AND ")}
    ORDER BY r.id DESC
    LIMIT ?
  `,
    params,
  );

  const ids = rows.map((r) => r.id);
  const dataById = await loadRecordDataByIds(ids);
  const outRows = rows.map((r) => ({
    id: r.id,
    updated_at: r.updated_at,
    data: dataById.get(r.id) ?? {},
  }));
  return NextResponse.json({ records: outRows });
}

export async function POST(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fields = await getPurchaseFields();
  const allowedFields = new Set(fields);

  const body = await req.json().catch(() => null);
  const parsed = z.object({ id: z.number().int().positive(), data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeData(parsed.data.data, fields);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      await conn.query<ResultSetHeader>(
        "INSERT INTO purchase_records(id, data) VALUES (?, CAST(? AS JSON))",
        [parsed.data.id, JSON.stringify(normalized)],
      );
    } catch {
      await conn.rollback();
      return NextResponse.json({ error: "已存在" }, { status: 409 });
    }
    await upsertRecordFields(conn, parsed.data.id, normalized, allowedFields);
    await conn.commit();
  } finally {
    conn.release();
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
