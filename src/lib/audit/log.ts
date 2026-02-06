import "server-only";

import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db/pool";

export async function logOperation(params: {
  req?: NextRequest;
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: unknown;
}) {
  const pool = getPool();
  const ip =
    params.req?.headers.get("x-forwarded-for") ??
    params.req?.headers.get("x-real-ip") ??
    null;
  const userAgent = params.req?.headers.get("user-agent") ?? null;

  await pool.query<ResultSetHeader>(
    "INSERT INTO operation_logs(actor_user_id, action, target_type, target_id, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      params.actorUserId ? Number(params.actorUserId) : null,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.detail ? JSON.stringify(params.detail) : null,
      ip,
      userAgent,
    ],
  );
}

export async function hasOperationLogToday(params: { actorUserId?: string | null; action: string }) {
  const pool = getPool();
  const where: string[] = [
    "action = ?",
    "created_at >= CURDATE()",
    "created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
  ];
  const sqlParams: unknown[] = [params.action];
  if (params.actorUserId) {
    where.unshift("actor_user_id = ?");
    sqlParams.unshift(Number(params.actorUserId));
  }
  const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
    `
    SELECT id
    FROM operation_logs
    WHERE ${where.join("\n      AND ")}
    LIMIT 1
  `,
    sqlParams,
  );
  return rows.length > 0;
}
