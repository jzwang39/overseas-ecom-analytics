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

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  const recordId = Number(id);
  if (!Number.isFinite(recordId) || recordId <= 0) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const fields = await getPurchaseFields();
  const allowedFields = new Set(fields);
  const normalized = normalizeData(parsed.data.data, fields);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM purchase_records WHERE id = ? LIMIT 1",
      [recordId],
    );
    if (existing.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "不存在" }, { status: 404 });
    }

    await conn.query<ResultSetHeader>(
      "UPDATE purchase_records SET data = CAST(? AS JSON) WHERE id = ?",
      [JSON.stringify(normalized), recordId],
    );
    await upsertRecordFields(conn, recordId, normalized, allowedFields);
    await conn.commit();
  } finally {
    conn.release();
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "purchase.update",
    targetType: "purchase_record",
    targetId: String(recordId),
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
