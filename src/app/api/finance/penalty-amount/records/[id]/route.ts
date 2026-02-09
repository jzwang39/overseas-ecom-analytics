import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

const RECORD_TYPE = "penalty_amount";

const TEMU_PENALTY_AMOUNT_FIELDS: string[] = [
  "违规编号",
  "订单编号",
  "违规类型",
  "支出金额",
  "币种",
  "账务时间",
];

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

let cachedFields: string[] | null = null;
let cachedFieldsAt = 0;
async function getPenaltyAmountFields() {
  const now = Date.now();
  if (cachedFields && now - cachedFieldsAt < 3000) return cachedFields;
  const fromDefs = await getFieldsFromRecordDefs();
  cachedFields = fromDefs.length > 0 ? fromDefs : TEMU_PENALTY_AMOUNT_FIELDS;
  cachedFieldsAt = now;
  return cachedFields;
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
        `DELETE FROM penalty_amount_record_fields WHERE penalty_amount_record_id = ? AND field_key IN (${placeholders})`,
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
        INSERT INTO penalty_amount_record_fields(penalty_amount_record_id, field_key, field_value)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)
      `,
        params,
      );
    }
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fields = await getPenaltyAmountFields();
  const allowedFields = new Set(fields);

  const { id } = await ctx.params;
  const recordId = Number(id);
  if (!Number.isFinite(recordId) || recordId <= 0) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeData(parsed.data.data, fields);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM penalty_amount_records WHERE id = ? LIMIT 1",
      [recordId],
    );
    if (existing.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "不存在" }, { status: 404 });
    }

    await conn.query<ResultSetHeader>("UPDATE penalty_amount_records SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      recordId,
    ]);
    await upsertRecordFields(conn, recordId, normalized, allowedFields);
    await conn.commit();
  } finally {
    conn.release();
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "penalty_amount.update",
    targetType: "penalty_amount_record",
    targetId: String(recordId),
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
