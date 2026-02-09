import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { getPool } from "@/lib/db/pool";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { SKYNEST_PURCHASE_FIELDS_2025 } from "@/lib/workspace/schemas";

export const runtime = "nodejs";

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

async function saveFieldsToRecordDefs(fields: string[]) {
  if (fields.length === 0) return;
  const pool = getPool();
  const placeholders = fields.map(() => "(?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (let i = 0; i < fields.length; i++) params.push(RECORD_TYPE, fields[i], i + 1);
  try {
    await pool.query<ResultSetHeader>(
      `
      INSERT IGNORE INTO record_field_defs(record_type, field_key, sort_order)
      VALUES ${placeholders}
    `,
      params,
    );
  } catch {}
}

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fromDefs = await getFieldsFromRecordDefs();
  if (fromDefs.length > 0) return NextResponse.json({ fields: fromDefs });

  await saveFieldsToRecordDefs(SKYNEST_PURCHASE_FIELDS_2025);
  const fields = SKYNEST_PURCHASE_FIELDS_2025;
  return NextResponse.json({ fields });
}
