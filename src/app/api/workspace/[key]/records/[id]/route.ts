import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";
import { getPool } from "@/lib/db/pool";
import { MENU_GROUPS } from "@/lib/menu/config";
import { logOperation } from "@/lib/audit/log";
import { getWorkspaceSchema } from "@/lib/workspace/schemas";

export const runtime = "nodejs";

function isValidWorkspaceKey(key: string) {
  for (const g of MENU_GROUPS) for (const it of g.items) if (it.key === key) return true;
  return false;
}

function normalizeAbandonReason(value: unknown) {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v : null;
}

function resolveStorageWorkspaceKey(key: string) {
  if (key === "ops.inquiry") return "ops.selection";
  if (key === "ops.pricing") return "ops.purchase";
  if (key === "ops.confirm") return "ops.purchase";
  return key;
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

function normalizeWorkspaceData(workspaceKey: string, input: Record<string, unknown>) {
  if (!getWorkspaceSchema(workspaceKey)) return input;
  const out: Record<string, unknown> = { ...input };
  out["最后更新时间"] = todayYmd();
  if (!out["状态"]) out["状态"] = "进行中";
  return out;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ key: string; id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key, id } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const recordId = Number(id);
  if (!Number.isFinite(recordId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const normalized = normalizeWorkspaceData(key, parsed.data.data);
  const abandonReason = normalizeAbandonReason(normalized["放弃理由"]);
  const pool = getPool();
  let storageKey = resolveStorageWorkspaceKey(key);
  if (key === "ops.confirm") {
    const [inPurchase] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
      [recordId, "ops.purchase"],
    );
    if (inPurchase.length > 0) storageKey = "ops.purchase";
    else {
      const [inSelection] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
        [recordId, "ops.selection"],
      );
      if (inSelection.length > 0) storageKey = "ops.selection";
      else return NextResponse.json({ error: "不存在" }, { status: 404 });
    }
  } else {
    const [existing] = await pool.query<(RowDataPacket & { id: number; data: unknown })[]>(
      "SELECT id, data FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
      [recordId, storageKey],
    );
    if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });

    if (key === "ops.inquiry") {
      const isAdmin = session.user.permissionLevel !== "user";
      if (!isAdmin) {
        const roleName = typeof session.user.roleName === "string" ? session.user.roleName : "";
        const isManager = roleName.includes("询价");
        if (!isManager) {
          const rawData = existing[0]?.data;
          const obj = rawData && typeof rawData === "object" && !Array.isArray(rawData)
            ? (rawData as Record<string, unknown>)
            : {};
          const assignee = typeof obj["询价人"] === "string" ? obj["询价人"].trim() : "";
          const currentUsername = typeof session.user.username === "string" ? session.user.username : "";
          if (!assignee || !currentUsername || assignee !== currentUsername) {
            return NextResponse.json({ error: "无权限：仅被分配的询价人可修改此记录" }, { status: 403 });
          }
        }
      }
    }
  }

  await pool.query<ResultSetHeader>(
    "UPDATE workspace_records SET data = CAST(? AS JSON), abandon_reason = ? WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL",
    [JSON.stringify(normalized), abandonReason, recordId, storageKey],
  );

  if (key === "ops.confirm") {
    const status = typeof normalized["状态"] === "string" ? normalized["状态"].trim() : "";
    if ((status === "待采购" || status === "待核价") && storageKey === "ops.selection") {
      const productRule = typeof normalized["产品规则"] === "string" ? normalized["产品规则"].trim() : "";
      if (productRule) {
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET deleted_at = NOW() WHERE workspace_key = ? AND product_rule = ? AND deleted_at IS NULL AND id <> ? LIMIT 1",
          ["ops.purchase", productRule, recordId],
        );
      }
      try {
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET workspace_key = ? WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
          ["ops.purchase", recordId, storageKey],
        );
      } catch (err) {
        const e = err as { code?: unknown };
        const code = typeof e?.code === "string" ? e.code : "";
        if (code !== "ER_DUP_ENTRY" || !productRule) throw err;
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET deleted_at = NOW() WHERE workspace_key = ? AND product_rule = ? AND deleted_at IS NULL AND id <> ? LIMIT 1",
          ["ops.purchase", productRule, recordId],
        );
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET workspace_key = ? WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
          ["ops.purchase", recordId, storageKey],
        );
      }
    }
  }

  if (key === "ops.inquiry") {
    const status = typeof normalized["状态"] === "string" ? normalized["状态"].trim() : "";
    if (status === "待核价" || status === "待分配运营者") {
      const productRule = typeof normalized["产品规则"] === "string" ? normalized["产品规则"].trim() : "";
      try {
        await pool.query<ResultSetHeader>(
          "INSERT INTO workspace_records(workspace_key, data, abandon_reason) VALUES (?, CAST(? AS JSON), ?)",
          ["ops.purchase", JSON.stringify(normalized), abandonReason],
        );
      } catch (err) {
        const e = err as { code?: unknown };
        const code = typeof e?.code === "string" ? e.code : "";
        if (code !== "ER_DUP_ENTRY" || !productRule) throw err;
        await pool.query<ResultSetHeader>(
          `
            UPDATE workspace_records
            SET data = CAST(? AS JSON), abandon_reason = ?
            WHERE workspace_key = ?
              AND product_rule = ?
              AND deleted_at IS NULL
            LIMIT 1
          `,
          [JSON.stringify(normalized), abandonReason, "ops.purchase", productRule],
        );
      }
    }
  }

  if (key === "ops.pricing") {
    const status = typeof normalized["状态"] === "string" ? normalized["状态"].trim() : "";
    if (status === "待询价") {
      const productRule = typeof normalized["产品规则"] === "string" ? normalized["产品规则"].trim() : "";
      if (productRule) {
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET deleted_at = NOW() WHERE workspace_key = ? AND product_rule = ? AND deleted_at IS NULL AND id <> ? LIMIT 1",
          ["ops.selection", productRule, recordId],
        );
      }
      try {
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET workspace_key = ? WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
          ["ops.selection", recordId, storageKey],
        );
      } catch (err) {
        const e = err as { code?: unknown };
        const code = typeof e?.code === "string" ? e.code : "";
        if (code !== "ER_DUP_ENTRY" || !productRule) throw err;
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET deleted_at = NOW() WHERE workspace_key = ? AND product_rule = ? AND deleted_at IS NULL AND id <> ? LIMIT 1",
          ["ops.selection", productRule, recordId],
        );
        await pool.query<ResultSetHeader>(
          "UPDATE workspace_records SET workspace_key = ? WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
          ["ops.selection", recordId, storageKey],
        );
      }
    }
  }

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "workspace.update",
    targetType: "workspace_record",
    targetId: String(recordId),
    detail: { workspaceKey: key },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ key: string; id: string }> },
) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key, id } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const recordId = Number(id);
  if (!Number.isFinite(recordId)) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);

  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM workspace_records WHERE id = ? AND workspace_key = ? AND deleted_at IS NULL LIMIT 1",
    [recordId, storageKey],
  );
  if (existing.length === 0) return NextResponse.json({ error: "不存在" }, { status: 404 });

  await pool.query("UPDATE workspace_records SET deleted_at = NOW() WHERE id = ?", [recordId]);

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "workspace.delete",
    targetType: "workspace_record",
    targetId: String(recordId),
    detail: { workspaceKey: key },
  });

  return NextResponse.json({ ok: true });
}
