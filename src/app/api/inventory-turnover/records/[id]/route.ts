import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

const RECORD_TYPE = "inventory_turnover";

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeData(input: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) out[k] = v == null ? "" : String(v);
  return out;
}

async function ensureFieldDefs(conn: PoolConnection, keys: string[]) {
  const cleaned = keys.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return;
  const uniq = Array.from(new Set(cleaned));
  for (const batch of chunkArray(uniq, 200)) {
    const placeholders = batch.map(() => "(?, ?)").join(", ");
    const params: unknown[] = [];
    for (const k of batch) params.push(RECORD_TYPE, k);
    await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO record_field_defs(record_type, field_key) VALUES ${placeholders}`,
      params,
    );
  }
}

async function upsertRecordFields(conn: PoolConnection, recordId: number, data: Record<string, string>) {
  const entries: Array<[string, string]> = [];
  const emptyKeys: string[] = [];
  for (const [k, vRaw] of Object.entries(data)) {
    const key = k.trim();
    if (!key) continue;
    const v = vRaw.trim();
    if (!v) emptyKeys.push(key);
    else entries.push([key, v]);
  }

  if (emptyKeys.length) {
    for (const batch of chunkArray(Array.from(new Set(emptyKeys)), 200)) {
      const placeholders = batch.map(() => "?").join(", ");
      await conn.query<ResultSetHeader>(
        `DELETE FROM inventory_record_fields WHERE inventory_record_id = ? AND field_key IN (${placeholders})`,
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
        INSERT INTO inventory_record_fields(inventory_record_id, field_key, field_value)
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

  const { id } = await ctx.params;
  const recordId = Number(id);
  if (!Number.isFinite(recordId) || recordId <= 0) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeData(parsed.data.data);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM inventory_records WHERE id = ? LIMIT 1",
      [recordId],
    );
    if (existing.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "不存在" }, { status: 404 });
    }

    await conn.query<ResultSetHeader>("UPDATE inventory_records SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      recordId,
    ]);
    await ensureFieldDefs(conn, Object.keys(normalized));
    await upsertRecordFields(conn, recordId, normalized);
    await conn.commit();
  } finally {
    conn.release();
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "inventory.update",
    targetType: "inventory_record",
    targetId: String(recordId),
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
