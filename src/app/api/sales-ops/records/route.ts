import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { hasOperationLogToday, logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { ZHIFAN_SALES_OPS_FIELDS } from "@/lib/workspace/schemas";

const RECORD_TYPE = "sales_ops";

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeData(input: Record<string, unknown>, fields: string[]) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f];
    out[f] = v == null ? "" : String(v);
  }
  return out;
}

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
  try {
    const [rows] = await pool.query<(RowDataPacket & { field_key: string })[]>(
      `
      SELECT field_key
      FROM sales_ops_record_fields
      GROUP BY field_key
      ORDER BY field_key ASC
      LIMIT 1000
    `,
    );
    return rows.map((r) => r.field_key);
  } catch {
    return [];
  }
}

let cachedFields: string[] | null = null;
let cachedFieldsAt = 0;
async function getSalesOpsFields() {
  const now = Date.now();
  if (cachedFields && now - cachedFieldsAt < 3000) return cachedFields;
  const fromDefs = await getFieldsFromRecordDefs();
  if (fromDefs.length > 0) {
    cachedFields = fromDefs;
  } else {
    const fromFields = await getFieldsFromRecordFields();
    cachedFields = fromFields.length > 0 ? fromFields : ZHIFAN_SALES_OPS_FIELDS;
  }
  cachedFieldsAt = now;
  return cachedFields;
}

async function loadRecordDataByIds(ids: number[]) {
  if (ids.length === 0) return new Map<number, Record<string, unknown>>();
  const pool = getPool();
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.query<
    (RowDataPacket & {
      sales_ops_record_id: number;
      field_key: string;
      field_value: string | null;
    })[]
  >(
    `
    SELECT sales_ops_record_id, field_key, field_value
    FROM sales_ops_record_fields
    WHERE sales_ops_record_id IN (${placeholders})
  `,
    ids,
  );
  const out = new Map<number, Record<string, unknown>>();
  for (const id of ids) out.set(id, {});
  for (const r of rows) {
    const obj = out.get(r.sales_ops_record_id);
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
    const key = k.trim();
    if (!key) continue;
    if (!allowedFields.has(key)) continue;
    const v = vRaw.trim();
    if (!v) emptyKeys.push(key);
    else entries.push([key, v]);
  }

  if (emptyKeys.length) {
    for (const batch of chunkArray(Array.from(new Set(emptyKeys)), 200)) {
      const placeholders = batch.map(() => "?").join(", ");
      await conn.query<ResultSetHeader>(
        `DELETE FROM sales_ops_record_fields WHERE sales_ops_record_id = ? AND field_key IN (${placeholders})`,
        [recordId, ...batch],
      );
    }
  }

  if (entries.length) {
    for (const batch of chunkArray(entries, 200)) {
      const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
      const params: unknown[] = [];
      for (const [k, v] of batch) params.push(recordId, k, v);
      await conn.query<ResultSetHeader>(
        `
        INSERT INTO sales_ops_record_fields(sales_ops_record_id, field_key, field_value)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)
      `,
        params,
      );
    }
  }
}

export async function GET(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fields = await getSalesOpsFields();
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
        FROM sales_ops_record_fields kv
        WHERE kv.sales_ops_record_id = r.id
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
        FROM sales_ops_record_fields kv
        WHERE kv.sales_ops_record_id = r.id
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
    FROM sales_ops_records r
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

  const fields = await getSalesOpsFields();
  const allowedFields = new Set(fields);

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

  if ("action" in parsed.data && parsed.data.action === "batch_copy_yesterday") {
    const action = "sales_ops.batch_copy_yesterday";
    if (await hasOperationLogToday({ action })) {
      return NextResponse.json({ error: "今日已执行过批量新增" }, { status: 409 });
    }
    const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
      `
      SELECT id
      FROM sales_ops_records
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND created_at < CURDATE()
      ORDER BY id ASC
    `,
    );

    if (rows.length === 0) {
      return NextResponse.json({ inserted: 0 });
    }

    const oldIds = rows.map((r) => r.id);
    const keepFields = Array.from(
      new Set(parsed.data.keepFields.map((f) => f.trim()).filter((f) => Boolean(f) && allowedFields.has(f))),
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const insertPlaceholders = oldIds.map(() => "()").join(", ");
      const [result] = await conn.query<ResultSetHeader>(`INSERT INTO sales_ops_records() VALUES ${insertPlaceholders}`);
      const inserted = result.affectedRows ?? 0;
      const firstId = Number(result.insertId);
      const newIds = Array.from({ length: inserted }, (_, i) => firstId + i);

      if (keepFields.length) {
        const idPlaceholders = oldIds.map(() => "?").join(", ");
        const keepPlaceholders = keepFields.map(() => "?").join(", ");
        const [kvRows] = await conn.query<
          (RowDataPacket & {
            sales_ops_record_id: number;
            field_key: string;
            field_value: string | null;
          })[]
        >(
          `
          SELECT sales_ops_record_id, field_key, field_value
          FROM sales_ops_record_fields
          WHERE sales_ops_record_id IN (${idPlaceholders})
            AND field_key IN (${keepPlaceholders})
        `,
          [...oldIds, ...keepFields],
        );

        const byOldId = new Map<number, Map<string, string>>();
        for (const id of oldIds) byOldId.set(id, new Map());
        for (const r of kvRows) {
          const m = byOldId.get(r.sales_ops_record_id);
          if (!m) continue;
          m.set(r.field_key, r.field_value ?? "");
        }

        const tuples: Array<[number, string, string]> = [];
        for (let i = 0; i < oldIds.length; i++) {
          const oldId = oldIds[i];
          const newId = newIds[i];
          const m = byOldId.get(oldId) ?? new Map();
          for (const f of keepFields) {
            const v = (m.get(f) ?? "").trim();
            if (!v) continue;
            tuples.push([newId, f, v]);
          }
        }

        for (const batch of chunkArray(tuples, 200)) {
          const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
          const params: unknown[] = [];
          for (const [rid, k, v] of batch) params.push(rid, k, v);
          await conn.query<ResultSetHeader>(
            `
            INSERT INTO sales_ops_record_fields(sales_ops_record_id, field_key, field_value)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)
          `,
            params,
          );
        }
      }

      await conn.commit();

      await logOperation({
        req,
        actorUserId: session.user.id,
        action,
        targetType: "sales_ops_record",
        targetId: null,
        detail: { inserted, keepFields: parsed.data.keepFields },
      });

      return NextResponse.json({ inserted });
    } finally {
      conn.release();
    }
  }

  if (!("data" in parsed.data)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeData(parsed.data.data, fields);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query<ResultSetHeader>("INSERT INTO sales_ops_records() VALUES ()");
    const recordId = Number(result.insertId);
    await upsertRecordFields(conn, recordId, normalized, allowedFields);
    await conn.commit();

    await logOperation({
      req,
      actorUserId: session.user.id,
      action: "sales_ops.create",
      targetType: "sales_ops_record",
      targetId: String(recordId),
      detail: null,
    });

    return NextResponse.json({ id: String(recordId) });
  } finally {
    conn.release();
  }
}
