import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

const RECORD_TYPE = "inventory_turnover";
const FALLBACK_FIELDS = ["运营人员", "店铺名称", "产品名称", "SKC", "SKU", "产品规格", "链接标签"];

async function getFieldsFromRecordDefs() {
  const pool = getPool();
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
}

async function getFieldsFromRecordFields() {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { field_key: string })[]>(
    `
    SELECT field_key
    FROM inventory_record_fields
    GROUP BY field_key
    ORDER BY field_key ASC
    LIMIT 500
  `,
  );
  return rows.map((r) => r.field_key);
}

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const fromDefs = await getFieldsFromRecordDefs();
  if (fromDefs.length > 0) return NextResponse.json({ fields: fromDefs });

  const fromFields = await getFieldsFromRecordFields();
  const fields = fromFields.length > 0 ? fromFields : FALLBACK_FIELDS;
  return NextResponse.json({ fields });
}
