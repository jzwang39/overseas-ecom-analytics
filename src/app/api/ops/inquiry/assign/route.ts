import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { logOperation } from "@/lib/audit/log";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

function getDbErrorResponse(err: unknown) {
  if (!err || typeof err !== "object") return { status: 500, error: "数据库错误" };
  const e = err as { code?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "ER_NO_SUCH_TABLE") return { status: 500, error: "数据库未迁移" };
  return { status: 500, error: "数据库错误" };
}

function todayYmd() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

async function isRoleName(roleId: number | null | undefined, roleName: string) {
  if (!roleId) return false;
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [roleId],
  );
  return rows.length > 0 && rows[0]?.name === roleName;
}

function toRoleId(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toObject(value: unknown) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function GET() {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const isAdmin = session.user.permissionLevel !== "user";
    const ok = isAdmin || (await isRoleName(toRoleId(session.user.roleId), "询价负责人"));
    if (!ok) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { username: string; display_name: string | null })[]>(
      `
        SELECT u.username, u.display_name
        FROM users u
        INNER JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL
        WHERE u.deleted_at IS NULL
          AND u.is_disabled = 0
          AND r.name = ?
        ORDER BY u.username ASC
        LIMIT 1000
      `,
      ["询价人"],
    );

    return NextResponse.json({
      users: rows.map((r) => ({ username: r.username, displayName: r.display_name ?? "" })),
    });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}

export async function PATCH(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .union([
      z.object({
        recordId: z.number().int(),
        assigneeUsername: z.string().trim().min(1),
      }),
      z.object({
        recordIds: z.array(z.number().int()).min(1).max(200),
        assigneeUsername: z.string().trim().min(1),
      }),
    ])
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  try {
    const pool = getPool();
    const isAdmin = session.user.permissionLevel !== "user";
    const isOwnerRole = await isRoleName(toRoleId(session.user.roleId), "询价负责人");
    const currentUsername = typeof session.user.username === "string" ? session.user.username : "";

    const [assignees] = await pool.query<(RowDataPacket & { username: string })[]>(
      `
        SELECT u.username
        FROM users u
        INNER JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL
        WHERE u.deleted_at IS NULL
          AND u.is_disabled = 0
          AND r.name = ?
          AND u.username = ?
        LIMIT 1
      `,
      ["询价人", parsed.data.assigneeUsername],
    );
    if (assignees.length === 0) return NextResponse.json({ error: "询价人不存在或无权限" }, { status: 400 });

    const now = todayYmd();

    if ("recordId" in parsed.data) {
      const [rows] = await pool.query<(RowDataPacket & { id: number; data: unknown })[]>(
        "SELECT id, data FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
        [parsed.data.recordId, "ops.purchase"],
      );
      if (rows.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });

      const obj = toObject(rows[0]?.data);
      if (!obj) return NextResponse.json({ error: "数据格式错误" }, { status: 500 });

      const recordOwner = String(obj["询价负责人"] ?? "").trim();
      const isRecordOwner = Boolean(currentUsername && recordOwner && recordOwner === currentUsername);
      if (!isAdmin && !isOwnerRole && !isRecordOwner) return NextResponse.json({ error: "无权限" }, { status: 403 });

      const next: Record<string, unknown> = { ...obj };
      next["询价人"] = parsed.data.assigneeUsername;
      next["最后更新时间"] = now;

      await pool.query<ResultSetHeader>("UPDATE workspace_records SET data = CAST(? AS JSON) WHERE id = ?", [
        JSON.stringify(next),
        parsed.data.recordId,
      ]);

      await logOperation({
        req,
        actorUserId: session.user.id,
        action: "inquiry.assign",
        targetType: "workspace_record",
        targetId: String(parsed.data.recordId),
        detail: { workspaceKey: "ops.inquiry", assigneeUsername: parsed.data.assigneeUsername },
      });

      return NextResponse.json({ ok: true });
    }

    const recordIds = Array.from(new Set(parsed.data.recordIds));
    const [rows] = await pool.query<(RowDataPacket & { id: number; data: unknown })[]>(
      "SELECT id, data FROM workspace_records WHERE id IN (?) AND workspace_key = ? AND deleted_at IS NULL",
      [recordIds, "ops.purchase"],
    );
    if (rows.length !== recordIds.length) return NextResponse.json({ error: "部分记录不存在" }, { status: 404 });

    if (!isAdmin && !isOwnerRole) {
      if (!currentUsername) return NextResponse.json({ error: "无权限" }, { status: 403 });
      for (const r of rows) {
        const obj = toObject(r.data);
        if (!obj) return NextResponse.json({ error: "数据格式错误" }, { status: 500 });
        const recordOwner = String(obj["询价负责人"] ?? "").trim();
        if (!recordOwner || recordOwner !== currentUsername) return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    }

    const [updated] = await pool.query<ResultSetHeader>(
      `
        UPDATE workspace_records
        SET data = JSON_SET(data, '$."询价人"', ?, '$."最后更新时间"', ?)
        WHERE id IN (?)
          AND workspace_key = ?
          AND deleted_at IS NULL
      `,
      [parsed.data.assigneeUsername, now, recordIds, "ops.purchase"],
    );

    for (const id of recordIds) {
      await logOperation({
        req,
        actorUserId: session.user.id,
        action: "inquiry.assign",
        targetType: "workspace_record",
        targetId: String(id),
        detail: {
          workspaceKey: "ops.inquiry",
          assigneeUsername: parsed.data.assigneeUsername,
          bulk: true,
          count: recordIds.length,
        },
      });
    }

    return NextResponse.json({ ok: true, affectedRows: updated.affectedRows });
  } catch (err) {
    const r = getDbErrorResponse(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
