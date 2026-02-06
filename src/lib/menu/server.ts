import "server-only";

import type { RowDataPacket } from "mysql2";
import { ensureDatabaseMigrationsApplied } from "../db/migrate";
import { getPool } from "../db/pool";
import { MENU_GROUPS } from "./config";

function allMenuKeys() {
  const keys: string[] = [];
  for (const g of MENU_GROUPS) {
    for (const it of g.items) keys.push(it.key);
  }
  return new Set(keys);
}

function parseMenuKeys(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
      return [];
    } catch {
      return [];
    }
  }
  if (value instanceof Buffer) {
    try {
      const parsed = JSON.parse(value.toString("utf8"));
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getAllowedMenuKeysByRoleId(roleId: string | null) {
  if (!roleId) return allMenuKeys();

  await ensureDatabaseMigrationsApplied();

  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { menu_keys: unknown })[]>(
    "SELECT menu_keys FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [roleId],
  );
  if (rows.length === 0) return new Set<string>();
  const keys = parseMenuKeys(rows[0].menu_keys);
  return new Set(keys);
}
