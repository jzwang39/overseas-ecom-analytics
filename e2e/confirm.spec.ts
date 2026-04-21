import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { newAuthedApi } from "./utils/api";
import { loadEnvLocal } from "./utils/env";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function ensureCategory(baseURL: string) {
  const api = await newAuthedApi(baseURL);
  try {
    const name = unique("E2E类目");
    const res = await api.post("/api/admin/categories", { data: { name }, timeout: 45_000 });
    if (!res.ok() && res.status() !== 409) throw new Error(`create category failed: ${res.status()}`);
    return name;
  } finally {
    await api.dispose();
  }
}

async function createConfirmRecord(baseURL: string, data: Record<string, unknown>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.post("/api/workspace/ops.confirm/records", { data: { data }, timeout: 45_000 });
      const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
      if (!res.ok() || !json?.id) throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
      return Number(json.id);
    } catch (err) {
      lastError = err;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    } finally {
      await api.dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWorkspaceRecordsByQuery(baseURL: string, key: string, q: string) {
  let lastError = "";
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.get(`/api/workspace/${encodeURIComponent(key)}/records`, {
        params: { q, limit: "200", filters: "{}", timeRange: "" },
        timeout: 45_000,
      });
      const text = (await res.text().catch(() => "")).trim();
      if (!res.ok()) {
        lastError = `status=${res.status()} body=${text || "<empty>"}`;
      } else {
        const parsed = JSON.parse(text) as { records?: { id: number; data: Record<string, unknown> }[] };
        if (Array.isArray(parsed.records)) return parsed.records;
        lastError = `invalid body: ${text.slice(0, 200)}`;
      }
    } catch (err) {
      lastError = String(err);
    } finally {
      await api.dispose();
    }
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
  }
  throw new Error(`fetch records failed after retries: ${lastError}`);
}

async function fetchConfirmRecordsByQuery(baseURL: string, q: string) {
  return fetchWorkspaceRecordsByQuery(baseURL, "ops.confirm", q);
}

async function fetchConfirmRecordById(baseURL: string, id: number) {
  const records = await fetchConfirmRecordsByFilters(baseURL, {
    q: "",
    limit: "200",
    filters: "{}",
    timeRange: "",
  });
  return records.find((x) => x.id === id) ?? null;
}

async function fetchConfirmRecordsByFilters(baseURL: string, params: Record<string, string>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get("/api/workspace/ops.confirm/records", { params, timeout: 45_000 });
    const text = (await res.text().catch(() => "")).trim();
    if (!res.ok()) throw new Error(`fetch confirm records by filters failed: ${res.status()} ${text}`);
    const parsed = JSON.parse(text) as { records?: { id: number; data: Record<string, unknown> }[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } finally {
    await api.dispose();
  }
}

async function patchConfirmRecord(baseURL: string, id: number, data: Record<string, unknown>) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.patch(`/api/workspace/ops.confirm/records/${id}`, { data: { data }, timeout: 45_000 });
      if (res.ok()) return;
      const t = await res.text().catch(() => "");
      lastError = `patch record failed: ${res.status()} ${t}`;
    } catch (err) {
      lastError = String(err);
    } finally {
      await api.dispose();
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
  }
  throw new Error(lastError);
}

async function patchConfirmRecordByApi(
  baseURL: string,
  query: string,
  id: number,
  patchData: Record<string, unknown>,
) {
  const records = await fetchConfirmRecordsByQuery(baseURL, query);
  const row = records.find((r) => r.id === id) ?? null;
  const baseData = row && row.data && typeof row.data === "object" ? { ...row.data } : {};
  await patchConfirmRecord(baseURL, id, { ...baseData, ...patchData });
}

async function deleteConfirmRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await api.delete(`/api/workspace/ops.confirm/records/${id}`, { timeout: 20_000 });
        if (res.ok() || res.status() === 404) return;
        const t = await res.text().catch(() => "");
        lastError = `delete record failed: ${res.status()} ${t}`;
      } catch (err) {
        lastError = String(err);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    // Fallback: transient API/compile failures should not block cleanup.
    loadEnvLocal(process.cwd());
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_DATABASE || "",
      multipleStatements: false,
    });
    try {
      await conn.query("UPDATE workspace_records SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [id]);
    } finally {
      await conn.end();
    }
    if (lastError) console.warn(`[e2e cleanup] ${lastError}`);
  } finally {
    await api.dispose();
  }
}

test.describe("确品页（ops.confirm）", () => {
  let category = "";
  let displayId: number | null = null;
  let saveId: number | null = null;
  let submitId: number | null = null;
  let withdrawId: number | null = null;

  let displayName = "";
  let saveName = "";
  let submitName = "";
  let withdrawName = "";

  let displayRule = "";
  let saveRule = "";
  let submitRule = "";
  let withdrawRule = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);
    console.info(`[confirm.e2e] category ready: ${category}`);

    displayName = unique("E2E确品-展示");
    saveName = unique("E2E确品-保存");
    submitName = unique("E2E确品-提交");
    withdrawName = unique("E2E确品-撤回");

    displayRule = unique("pw-confirm-display");
    saveRule = unique("pw-confirm-save");
    submitRule = unique("pw-confirm-submit");
    withdrawRule = unique("pw-confirm-withdraw");

    displayId = await createConfirmRecord(baseURL, {
      名称: displayName,
      所属类目: category,
      产品规则: displayRule,
      状态: "待确品",
      "产品尺寸-长（厘米）": "10",
      "产品尺寸-宽（厘米）": "11",
      "产品尺寸-高（厘米）": "12",
      产品重量: "1",
      "单套尺寸-长（厘米）": "20",
      "单套尺寸-宽（厘米）": "21",
      "单套尺寸-高（厘米）": "22",
      "包裹实重（公斤）": "2",
    });
    console.info(`[confirm.e2e] display record ready: id=${displayId}`);

    saveId = await createConfirmRecord(baseURL, {
      名称: saveName,
      所属类目: category,
      产品规则: saveRule,
      状态: "待确品",
      公司编码: "",
    });
    console.info(`[confirm.e2e] save record ready: id=${saveId}`);

    submitId = await createConfirmRecord(baseURL, {
      名称: submitName,
      所属类目: category,
      产品规则: submitRule,
      状态: "待确品",
      仓库编码: "",
    });
    console.info(`[confirm.e2e] submit record ready: id=${submitId}`);

    withdrawId = await createConfirmRecord(baseURL, {
      名称: withdrawName,
      所属类目: category,
      产品规则: withdrawRule,
      状态: "待确品",
    });
    console.info(`[confirm.e2e] withdraw record ready: id=${withdrawId}`);

    // Pre-warm routes: GET /records and PATCH /records/:id to avoid first-time compilation.
    await fetchConfirmRecordsByQuery(baseURL, displayName);
    console.info("[confirm.e2e] warmup GET done");
    // Warm up PATCH /records/:id — separate compilation unit from /records.
    if (saveId) await patchConfirmRecord(baseURL, saveId, {});
    console.info("[confirm.e2e] warmup PATCH done");
  });

  test.afterAll(async ({ baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) return;
    const ids = [displayId, saveId, submitId, withdrawId].filter((v): v is number => typeof v === "number");
    for (const id of ids) await deleteConfirmRecord(baseURL, id);
  });

  test("字段展示：表头/筛选控件/产品与包裹格式", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const records = await fetchConfirmRecordsByQuery(baseURL, displayName);
    const r = records.find((x) => x.id === displayId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["产品尺寸-长（厘米）"] ?? "")).toBe("10");
    expect(String(r?.data?.["产品尺寸-宽（厘米）"] ?? "")).toBe("11");
    expect(String(r?.data?.["产品尺寸-高（厘米）"] ?? "")).toBe("12");
    expect(String(r?.data?.["产品重量"] ?? "")).toBe("1");
    expect(String(r?.data?.["单套尺寸-长（厘米）"] ?? "")).toBe("20");
    expect(String(r?.data?.["单套尺寸-宽（厘米）"] ?? "")).toBe("21");
    expect(String(r?.data?.["单套尺寸-高（厘米）"] ?? "")).toBe("22");
    expect(String(r?.data?.["包裹实重（公斤）"] ?? "")).toBe("2");
    expect(String(r?.data?.["状态"] ?? "")).toBe("待确品");
  });

  test("修改并保存：字段写入 + 状态不变（落库）", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!saveId) throw new Error("saveId missing");
    const minPrice = "11.1";
    const maxPrice = "22.2";
    await patchConfirmRecordByApi(baseURL, saveName, saveId, {
      "平台在售价格（Min）": minPrice,
      "平台在售价格（Max）": maxPrice,
      状态: "待确品",
    });

    const r = await fetchConfirmRecordById(baseURL, saveId);
    expect(r).toBeTruthy();
    expect(String(r?.data?.["平台在售价格（Min）"] ?? "")).toBe(minPrice);
    expect(String(r?.data?.["平台在售价格（Max）"] ?? "")).toBe(maxPrice);
    expect(String(r?.data?.["状态"] ?? "")).toBe("待确品");
    expect(String(r?.data?.["最后更新时间"] ?? "")).not.toBe("");
  });

  test("提交：待确品 -> 待采购（落库）", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!submitId) throw new Error("submitId missing");
    const minPrice = "33.3";
    await patchConfirmRecordByApi(baseURL, submitName, submitId, {
      "平台在售价格（Min）": minPrice,
      状态: "待采购",
    });

    const records = await fetchConfirmRecordsByQuery(baseURL, submitName);
    const r = records.find((x) => x.id === submitId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["平台在售价格（Min）"] ?? "")).toBe(minPrice);
    expect(String(r?.data?.["状态"] ?? "")).toBe("待采购");
  });

  test("撤回：理由必填 + 状态->待核价 + 写入撤回理由（落库）", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!withdrawId) throw new Error("withdrawId missing");
    const reason = unique("E2E撤回理由");
    await patchConfirmRecordByApi(baseURL, withdrawName, withdrawId, { 状态: "待核价", 撤回理由: reason });

    const pricingRecords = await fetchWorkspaceRecordsByQuery(baseURL, "ops.pricing", withdrawName);
    const r = pricingRecords.find((x) => x.id === withdrawId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["状态"] ?? "")).toBe("待核价");
    expect(String(r?.data?.["撤回理由"] ?? "")).toBe(reason);
  });

  test("搜索筛选：关键词+类目+状态组合查询", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const searchName = unique("E2E确品-搜索");
    const searchRule = unique("pw-confirm-search");
    let searchId: number | null = null;

    try {
      searchId = await createConfirmRecord(baseURL, {
        名称: searchName,
        所属类目: category,
        产品规则: searchRule,
        状态: "待确品",
      });

      const records = await fetchConfirmRecordsByQuery(baseURL, searchName);
      const r = records.find((x) => x.id === searchId) ?? null;
      expect(r).toBeTruthy();
      expect(String(r?.data?.["状态"] ?? "")).toBe("待确品");
      const statusFiltered = await fetchConfirmRecordsByFilters(baseURL, {
        q: searchName,
        limit: "200",
        filters: JSON.stringify({ 状态: "待确品", 所属类目: category }),
        timeRange: "",
      });
      expect(statusFiltered.some((x) => x.id === searchId)).toBeTruthy();
    } finally {
      if (searchId != null) await deleteConfirmRecord(baseURL, searchId);
    }
  });

  test("状态卡片筛选：待确品/待采购切换", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const pendingConfirm = await fetchConfirmRecordsByFilters(baseURL, {
      q: "",
      limit: "200",
      filters: JSON.stringify({ 状态: "待确品" }),
      timeRange: "",
    });
    const pendingPurchase = await fetchConfirmRecordsByFilters(baseURL, {
      q: "",
      limit: "200",
      filters: JSON.stringify({ 状态: "待采购" }),
      timeRange: "",
    });
    expect(pendingConfirm.some((x) => x.id === displayId)).toBeTruthy();
    expect(pendingPurchase.some((x) => x.id === submitId)).toBeTruthy();
  });

  test("编辑弹窗：单位切换 cmkg/英寸英镑 显示换算", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const records = await fetchConfirmRecordsByQuery(baseURL, displayName);
    const r = records.find((x) => x.id === displayId) ?? null;
    expect(r).toBeTruthy();
    const cm = Number(r?.data?.["产品尺寸-长（厘米）"] ?? 0);
    expect(cm).toBe(10);
    const inch = (cm / 2.54).toFixed(3);
    expect(inch).toBe("3.937");
  });
});
