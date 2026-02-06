import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "./pool";

export async function query<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params?: unknown[],
) {
  const pool = getPool();
  const [rows] = await pool.query<T>(sql, params);
  return rows;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

