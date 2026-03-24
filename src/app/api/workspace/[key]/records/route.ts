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

function normalizeWorkspaceData(workspaceKey: string, input: Record<string, unknown>, mode: "create" | "update") {
  if (!getWorkspaceSchema(workspaceKey)) return input;
  const out: Record<string, unknown> = { ...input };
  if (mode === "create" && !out["创建时间"]) out["创建时间"] = todayYmd();
  if (mode === "create") out["最后更新时间"] = null;
  else out["最后更新时间"] = todayYmd();
  if (!out["状态"]) out["状态"] = "进行中";
  return out;
}

function parseYmd(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mm - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mm - 1 || dt.getDate() !== d) return null;
  return dt;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const filtersRaw = url.searchParams.get("filters");
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "50")));
  const timeRangeRaw = url.searchParams.get("timeRange") ?? "";
  const startDateRaw = url.searchParams.get("startDate") ?? "";
  const endDateRaw = url.searchParams.get("endDate") ?? "";

  const filtersParsed = z
    .string()
    .transform((v) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    })
    .pipe(z.record(z.string(), z.string().optional()))
    .safeParse(filtersRaw ?? "{}");

  if (!filtersParsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const timeRangeParsed = z.enum(["", "today", "7d", "30d", "custom"]).safeParse(timeRangeRaw);
  if (!timeRangeParsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);
  if (key === "ops.inquiry") {
    await pool.query(
      `
        UPDATE workspace_records dst
        JOIN workspace_records src
          ON src.workspace_key = ?
         AND src.deleted_at IS NULL
         AND src.product_rule IS NOT NULL
         AND src.product_rule = dst.product_rule
        SET dst.deleted_at = NOW()
        WHERE dst.workspace_key = ?
          AND dst.deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(src.data, '$."状态"')) = ?
      `,
      ["ops.purchase", "ops.selection", "待询价"],
    );

    await pool.query(
      `
        UPDATE workspace_records
        SET workspace_key = ?
        WHERE workspace_key = ?
          AND deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(data, '$."状态"')) = ?
      `,
      ["ops.selection", "ops.purchase", "待询价"],
    );
  }
  if (key === "ops.pricing") {
    await pool.query(
      `
        UPDATE workspace_records dst
        JOIN workspace_records src
          ON src.workspace_key = ?
         AND src.deleted_at IS NULL
         AND src.product_rule IS NOT NULL
         AND src.product_rule = dst.product_rule
        SET dst.data = src.data, dst.abandon_reason = src.abandon_reason
        WHERE dst.workspace_key = ?
          AND dst.deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(dst.data, '$."状态"')) IN (?, ?)
          AND JSON_UNQUOTE(JSON_EXTRACT(src.data, '$."状态"')) IN (?, ?)
      `,
      ["ops.selection", "ops.purchase", "待分配运营者", "待分配运营", "待分配运营者", "待分配运营"],
    );

    await pool.query(
      `
        INSERT INTO workspace_records(workspace_key, data, abandon_reason)
        SELECT ?, src.data, src.abandon_reason
        FROM workspace_records src
        WHERE src.workspace_key = ?
          AND src.deleted_at IS NULL
          AND src.product_rule IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(src.data, '$."状态"')) IN (?, ?)
          AND NOT EXISTS (
            SELECT 1
            FROM workspace_records dst
            WHERE dst.workspace_key = ?
              AND dst.deleted_at IS NULL
              AND dst.product_rule = src.product_rule
          )
      `,
      ["ops.purchase", "ops.selection", "待分配运营者", "待分配运营", "ops.purchase"],
    );
  }

  if (key === "ops.purchase") {
    await pool.query(
      `
        UPDATE workspace_records dst
        JOIN workspace_records src
          ON src.workspace_key = ?
         AND src.deleted_at IS NULL
         AND src.product_rule IS NOT NULL
         AND src.product_rule = dst.product_rule
        SET dst.deleted_at = NOW()
        WHERE dst.workspace_key = ?
          AND dst.deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(src.data, '$."状态"')) = ?
      `,
      ["ops.selection", "ops.purchase", "待采购"],
    );

    await pool.query(
      `
        UPDATE workspace_records
        SET workspace_key = ?
        WHERE workspace_key = ?
          AND deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(data, '$."状态"')) = ?
      `,
      ["ops.purchase", "ops.selection", "待采购"],
    );
  }

  if (key === "ops.confirm") {
    const statusFilterRaw = (filtersParsed.data["状态"] ?? "").trim();
    const wantPendingConfirm = !statusFilterRaw || statusFilterRaw === "待确品";
    const wantNeedPurchase = !statusFilterRaw || statusFilterRaw === "待采购";
    if (statusFilterRaw && !wantPendingConfirm && !wantNeedPurchase) return NextResponse.json({ records: [] });

    const commonExtraWhere: string[] = [];
    const commonExtraParams: unknown[] = [];
    if (q) {
      commonExtraWhere.push("CAST(data AS CHAR) LIKE ?");
      commonExtraParams.push(`%${q}%`);
    }

    for (const [field, value] of Object.entries(filtersParsed.data)) {
      if (field === "状态") continue;
      const v = (value ?? "").trim();
      if (!v) continue;
      if (field === "放弃理由") {
        commonExtraWhere.push("abandon_reason LIKE ?");
        commonExtraParams.push(`%${v}%`);
      } else {
        commonExtraWhere.push("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) LIKE ?");
        commonExtraParams.push(`$."${field.replaceAll('"', '\\"')}"`);
        commonExtraParams.push(`%${v}%`);
      }
    }

    if (timeRangeParsed.data) {
      let start: Date | null = null;
      let end: Date | null = null;
      if (timeRangeParsed.data === "today") {
        start = new Date();
        start.setHours(0, 0, 0, 0);
      } else if (timeRangeParsed.data === "7d") {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      } else if (timeRangeParsed.data === "30d") {
        start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      } else if (timeRangeParsed.data === "custom") {
        const startDate = parseYmd(startDateRaw);
        const endDate = parseYmd(endDateRaw);
        if (!startDate || !endDate) return NextResponse.json({ error: "参数错误" }, { status: 400 });
        if (startDate.getTime() > endDate.getTime()) return NextResponse.json({ error: "参数错误" }, { status: 400 });
        start = startDate;
        start.setHours(0, 0, 0, 0);
        end = endDate;
        end.setHours(23, 59, 59, 999);
      }
      if (start) {
        commonExtraWhere.push("updated_at >= ?");
        commonExtraParams.push(start);
      }
      if (end) {
        commonExtraWhere.push("updated_at <= ?");
        commonExtraParams.push(end);
      }
    }

    const outRows: (RowDataPacket & { id: number; data: unknown; updated_at: string; abandon_reason: string | null })[] = [];

    if (wantPendingConfirm) {
      const params: unknown[] = ["ops.selection"];
      const where = ["workspace_key = ?", "deleted_at IS NULL", "JSON_UNQUOTE(JSON_EXTRACT(data, '$.\"状态\"')) = ?"];
      params.push("待确品");
      where.push(...commonExtraWhere);
      params.push(...commonExtraParams);
      params.push(limit);
      const [rows] = await pool.query<
        (RowDataPacket & { id: number; data: unknown; updated_at: string; abandon_reason: string | null })[]
      >(
        `
          SELECT id, data, updated_at, abandon_reason
          FROM workspace_records
          WHERE ${where.join(" AND ")}
          ORDER BY id DESC
          LIMIT ?
        `,
        params,
      );
      outRows.push(...rows);

      const params2: unknown[] = ["ops.purchase"];
      const where2 = ["workspace_key = ?", "deleted_at IS NULL", "JSON_UNQUOTE(JSON_EXTRACT(data, '$.\"状态\"')) = ?"];
      params2.push("待确品");
      where2.push(...commonExtraWhere);
      params2.push(...commonExtraParams);
      params2.push(limit);
      const [rows2] = await pool.query<
        (RowDataPacket & { id: number; data: unknown; updated_at: string; abandon_reason: string | null })[]
      >(
        `
          SELECT id, data, updated_at, abandon_reason
          FROM workspace_records
          WHERE ${where2.join(" AND ")}
          ORDER BY id DESC
          LIMIT ?
        `,
        params2,
      );
      outRows.push(...rows2);
    }

    if (wantNeedPurchase) {
      const params: unknown[] = ["ops.purchase"];
      const where = ["workspace_key = ?", "deleted_at IS NULL", "JSON_UNQUOTE(JSON_EXTRACT(data, '$.\"状态\"')) = ?"];
      params.push("待采购");
      where.push(...commonExtraWhere);
      params.push(...commonExtraParams);
      params.push(limit);
      const [rows] = await pool.query<
        (RowDataPacket & { id: number; data: unknown; updated_at: string; abandon_reason: string | null })[]
      >(
        `
          SELECT id, data, updated_at, abandon_reason
          FROM workspace_records
          WHERE ${where.join(" AND ")}
          ORDER BY id DESC
          LIMIT ?
        `,
        params,
      );
      outRows.push(...rows);
    }

    outRows.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const merged = outRows.slice(0, limit).map((r) => {
      const obj =
        r.data && typeof r.data === "object" && !Array.isArray(r.data)
          ? (r.data as Record<string, unknown>)
          : {};
      const currentReason = String(obj["放弃理由"] ?? "").trim();
      if (!currentReason && r.abandon_reason) {
        return { ...r, data: { ...obj, 放弃理由: r.abandon_reason } };
      }
      return r;
    });

    return NextResponse.json({ records: merged });
  }

  const params: unknown[] = [storageKey];
  const where = ["workspace_key = ?", "deleted_at IS NULL"];
  if (q) {
    where.push("CAST(data AS CHAR) LIKE ?");
    params.push(`%${q}%`);
  }

  for (const [field, value] of Object.entries(filtersParsed.data)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    if (field === "放弃理由") {
      where.push("abandon_reason LIKE ?");
      params.push(`%${v}%`);
    } else {
      where.push("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) LIKE ?");
      params.push(`$."${field.replaceAll('"', '\\"')}"`);
      params.push(`%${v}%`);
    }
  }

  if (timeRangeParsed.data) {
    let start: Date | null = null;
    let end: Date | null = null;
    if (timeRangeParsed.data === "today") {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    } else if (timeRangeParsed.data === "7d") {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRangeParsed.data === "30d") {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRangeParsed.data === "custom") {
      const startDate = parseYmd(startDateRaw);
      const endDate = parseYmd(endDateRaw);
      if (!startDate || !endDate) return NextResponse.json({ error: "参数错误" }, { status: 400 });
      if (startDate.getTime() > endDate.getTime()) return NextResponse.json({ error: "参数错误" }, { status: 400 });
      start = startDate;
      start.setHours(0, 0, 0, 0);
      end = endDate;
      end.setHours(23, 59, 59, 999);
    }
    if (start) {
      where.push("updated_at >= ?");
      params.push(start);
    }
    if (end) {
      where.push("updated_at <= ?");
      params.push(end);
    }
  }

  params.push(limit);

  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      data: unknown;
      updated_at: string;
      abandon_reason: string | null;
    })[]
  >(
    `
    SELECT id, data, updated_at, abandon_reason
    FROM workspace_records
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT ?
  `,
    params,
  );

  const records = rows.map((r) => {
    const obj =
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : {};
    const currentReason = String(obj["放弃理由"] ?? "").trim();
    if (!currentReason && r.abandon_reason) {
      return { ...r, data: { ...obj, 放弃理由: r.abandon_reason } };
    }
    return r;
  });

  return NextResponse.json({ records });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key } = await ctx.params;
  if (!isValidWorkspaceKey(key)) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.string(), z.any()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const pool = getPool();
  const storageKey = resolveStorageWorkspaceKey(key);
  const normalized = normalizeWorkspaceData(key, parsed.data.data, "create");
  const abandonReason = normalizeAbandonReason(normalized["放弃理由"]);

  if (storageKey === "ops.purchase") {
    const currentOwner = typeof normalized["询价负责人"] === "string" ? normalized["询价负责人"].trim() : "";
    if (!currentOwner) {
      const [rows] = await pool.query<(RowDataPacket & { username: string })[]>(
        `
        SELECT u.username
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND u.is_disabled = 0
          AND r.name = ?
        ORDER BY u.id ASC
        LIMIT 1
      `,
        ["询价负责人"],
      );

      if (rows.length > 0 && rows[0]?.username) normalized["询价负责人"] = rows[0].username;
    }
  }

  const productRule = typeof normalized["产品规则"] === "string" ? normalized["产品规则"].trim() : "";

  if (storageKey === "ops.purchase" && productRule) {
    try {
      const [result] = await pool.query<ResultSetHeader>(
        "INSERT INTO workspace_records(workspace_key, data, abandon_reason) VALUES (?, CAST(? AS JSON), ?)",
        [storageKey, JSON.stringify(normalized), abandonReason],
      );

      await logOperation({
        req,
        actorUserId: session.user.id,
        action: "workspace.create",
        targetType: "workspace_record",
        targetId: String(result.insertId),
        detail: { workspaceKey: key },
      });

      return NextResponse.json({ id: String(result.insertId) });
    } catch (err) {
      const e = err as { code?: unknown };
      const code = typeof e?.code === "string" ? e.code : "";
      if (code !== "ER_DUP_ENTRY") throw err;

      await pool.query<ResultSetHeader>(
        `
        UPDATE workspace_records
        SET data = CAST(? AS JSON), abandon_reason = ?
        WHERE workspace_key = ?
          AND product_rule = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
        [JSON.stringify(normalized), abandonReason, storageKey, productRule],
      );

      const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
        `
        SELECT id
        FROM workspace_records
        WHERE workspace_key = ?
          AND product_rule = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
        [storageKey, productRule],
      );
      if (rows.length === 0) return NextResponse.json({ error: "保存失败" }, { status: 500 });

      await logOperation({
        req,
        actorUserId: session.user.id,
        action: "workspace.update",
        targetType: "workspace_record",
        targetId: String(rows[0].id),
        detail: { workspaceKey: key, upsert: true },
      });

      return NextResponse.json({ id: String(rows[0].id) });
    }
  }

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO workspace_records(workspace_key, data, abandon_reason) VALUES (?, CAST(? AS JSON), ?)",
    [storageKey, JSON.stringify(normalized), abandonReason],
  );

  await logOperation({
    req,
    actorUserId: session.user.id,
    action: "workspace.create",
    targetType: "workspace_record",
    targetId: String(result.insertId),
    detail: { workspaceKey: key },
  });

  return NextResponse.json({ id: String(result.insertId) });
}
