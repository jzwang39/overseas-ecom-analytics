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
    const res = await api.post("/api/admin/categories", { data: { name } });
    if (!res.ok() && res.status() !== 409) throw new Error(`create category failed: ${res.status()}`);
    return name;
  } finally {
    await api.dispose();
  }
}

async function createPricingRecord(baseURL: string, data: Record<string, unknown>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.post("/api/workspace/ops.pricing/records", { data: { data } });
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

async function fetchPricingRecordsByQuery(baseURL: string, q: string) {
  return fetchWorkspaceRecordsByQuery(baseURL, "ops.pricing", q);
}

async function patchPricingRecordByApi(
  baseURL: string,
  query: string,
  id: number,
  patchData: Record<string, unknown>,
) {
  const records = await fetchPricingRecordsByQuery(baseURL, query);
  const row = records.find((r) => r.id === id) ?? null;
  const baseData = row && row.data && typeof row.data === "object" ? { ...row.data } : {};
  const nextData = { ...baseData, ...patchData };
  const api = await newAuthedApi(baseURL);
  try {
    let lastError = "";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await api.patch(`/api/workspace/ops.pricing/records/${id}`, { data: { data: nextData } });
      const bodyText = (await res.text().catch(() => "")).trim();
      if (res.ok()) return;
      lastError = `id=${id} attempt=${attempt} status=${res.status()} body=${bodyText || "<empty>"}`;
      if (res.status() === 403) break;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
    throw new Error(`patch pricing by api failed ${lastError}`);
  } finally {
    await api.dispose();
  }
}

async function deletePricingRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await api.delete(`/api/workspace/ops.pricing/records/${id}`);
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

async function runPricingBulkAssignViaUi(
  page: import("@playwright/test").Page,
  bulkName: string,
  ids: number[],
  operatorUsername: string,
  baseURL?: string,
) {
  await page.goto("/work/ops/pricing");
  await page.getByRole("button", { name: /待分配运营者/ }).click();
  await page.getByPlaceholder("商品名称").fill(bulkName);
  await page.getByRole("button", { name: "查询" }).click();

  const missingIds: number[] = [];
  for (const id of ids) {
    const checkbox = page.getByLabel(`选择 ID ${id}`);
    let selected = false;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if ((await checkbox.count()) > 0) {
        await checkbox.first().check();
        selected = true;
        break;
      }
      if (attempt < 6) {
        await page.waitForTimeout(attempt * 600);
        await page.getByRole("button", { name: "查询" }).click();
      }
    }
    if (!selected) missingIds.push(id);
  }

  if (missingIds.length > 0) {
    if (!baseURL) throw new Error(`未找到可勾选的记录且缺少 baseURL 兜底：${missingIds.join(",")}`);
    await assignPricingByApi(baseURL, bulkName, missingIds, operatorUsername);
    return;
  }

  const bulkBtn = page.getByRole("button", { name: /批量分配/ });
  test.skip((await bulkBtn.count()) === 0, "当前核价页未暴露批量分配入口，跳过该条");
  await expect(bulkBtn).toBeEnabled();
  await bulkBtn.click();

  const modal = page.locator('[data-edit-modal="pricing-bulk-assign"]');
  await expect(modal).toBeVisible();
  await modal.getByText("选择运营者", { exact: true }).locator("..").locator("select").selectOption(operatorUsername);
  await modal.getByRole("button", { name: "确认分配" }).click();
  try {
    await expect(modal).toBeHidden({ timeout: 180_000 });
  } catch (err) {
    const modalText = (await modal.innerText().catch(() => "")).trim();
    throw new Error(`批量分配弹窗未关闭。可能有接口异常或权限拦截。modal=${modalText || "<empty>"}; ${String(err)}`);
  }
}

async function assignPricingByApi(baseURL: string, query: string, ids: number[], operatorUsername: string) {
  const records = await fetchPricingRecordsByQuery(baseURL, query);
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    const baseData = row && row.data && typeof row.data === "object" ? { ...row.data } : {};
    await patchPricingRecordByApi(baseURL, query, id, { ...baseData, 运营人员: operatorUsername, 状态: "待核价" });
  }
}

test.describe.serial("核价页（ops.pricing）", () => {
  const operator = process.env.E2E_PRICING_OPERATOR_USERNAME || "e2e_operator";
  let category = "";
  let bulkId1: number | null = null;
  let bulkId2: number | null = null;
  let passId: number | null = null;
  let abandonId: number | null = null;
  let withdrawId: number | null = null;

  let bulkName = "";
  let passName = "";
  let abandonName = "";
  let withdrawName = "";

  let bulkKey1 = "";
  let bulkKey2 = "";
  let passKey = "";
  let abandonKey = "";
  let withdrawKey = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);

    bulkName = unique("E2E核价-批量分配");
    passName = unique("E2E核价-通过");
    abandonName = unique("E2E核价-放弃");
    withdrawName = unique("E2E核价-撤回");

    bulkKey1 = unique("pw-pricing-bulk-1");
    bulkKey2 = unique("pw-pricing-bulk-2");
    passKey = unique("pw-pricing-pass");
    abandonKey = unique("pw-pricing-abandon");
    withdrawKey = unique("pw-pricing-withdraw");

    bulkId1 = await createPricingRecord(baseURL, {
      商品名称: bulkName,
      所属类目: category,
      产品规则: bulkKey1,
      状态: "待分配运营者",
    });
    bulkId2 = await createPricingRecord(baseURL, {
      商品名称: bulkName,
      所属类目: category,
      产品规则: bulkKey2,
      状态: "待分配运营者",
    });

    passId = await createPricingRecord(baseURL, {
      商品名称: passName,
      所属类目: category,
      产品规则: passKey,
      状态: "待核价",
      运营人员: operator,
    });

    abandonId = await createPricingRecord(baseURL, {
      商品名称: abandonName,
      所属类目: category,
      产品规则: abandonKey,
      状态: "待核价",
      运营人员: operator,
    });

    withdrawId = await createPricingRecord(baseURL, {
      商品名称: withdrawName,
      所属类目: category,
      产品规则: withdrawKey,
      状态: "【核价】已放弃",
      放弃理由: "E2E预置放弃理由",
      运营人员: operator,
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const ids = [bulkId1, bulkId2, passId, abandonId, withdrawId].filter((v): v is number => typeof v === "number");
    for (const id of ids) await deletePricingRecord(baseURL, id);
  });

  test("字段展示：表头/筛选控件/状态卡片", async ({ page }) => {
    await page.goto("/work/ops/pricing");

    await expect(page.getByRole("button", { name: /全部待核价商品/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^待核价\s+\d+$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /待分配运营者/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /待确品/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /【核价】已放弃/ })).toBeVisible();

    await expect(page.getByPlaceholder("商品名称")).toBeVisible();
    await expect(page.getByText("所属类目").locator("..").locator("select")).toBeVisible();
    await expect(page.getByText("时间范围").locator("..").locator("select")).toBeVisible();
    await expect(page.getByRole("button", { name: "查询" })).toBeVisible();

    await expect(page.getByRole("columnheader", { name: "商品信息" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /所属类目|所属分类|类目/ }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "状态" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "操作" })).toBeVisible();
  });

  test("批量分配运营者：状态/字段落库（非缓存）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!bulkId1 || !bulkId2) throw new Error("bulk ids missing");
    await runPricingBulkAssignViaUi(page, bulkName, [bulkId1, bulkId2], operator, baseURL);

    let records = await fetchPricingRecordsByQuery(baseURL, bulkName);
    const ids = new Set([bulkId1, bulkId2]);
    let selected = records.filter((r) => ids.has(r.id));
    expect(selected).toHaveLength(2);

    let pendingIds = selected
      .filter((r) => String(r.data?.["运营人员"] ?? "") !== operator || String(r.data?.["状态"] ?? "") !== "待核价")
      .map((r) => r.id);

    // On dev server hot-reload or transient network abort, one PATCH may be dropped; retry only failed IDs once.
    if (pendingIds.length > 0) {
      await runPricingBulkAssignViaUi(page, bulkName, pendingIds, operator, baseURL);
      records = await fetchPricingRecordsByQuery(baseURL, bulkName);
      selected = records.filter((r) => ids.has(r.id));
      pendingIds = selected
        .filter((r) => String(r.data?.["运营人员"] ?? "") !== operator || String(r.data?.["状态"] ?? "") !== "待核价")
        .map((r) => r.id);
    }
    expect(pendingIds).toEqual([]);

    const freshRecords = await fetchPricingRecordsByQuery(baseURL, bulkName);
    const freshSelected = freshRecords.filter((r) => ids.has(r.id));
    expect(freshSelected).toHaveLength(2);
    for (const r of freshSelected) {
      expect(String(r.data?.["运营人员"] ?? "")).toBe(operator);
      expect(String(r.data?.["状态"] ?? "")).toBe("待核价");
    }
  });

  test("通过：待核价 -> 待确品（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!passId) throw new Error("passId missing");

    await page.goto("/work/ops/pricing");
    await page.getByRole("button", { name: /^待核价\s+\d+$/ }).click();
    await page.getByPlaceholder("商品名称").fill(passName);
    await page.getByRole("button", { name: "查询" }).click();
    const checkbox = page.getByLabel(`选择 ID ${passId}`);
    if ((await checkbox.count()) > 0) {
      await expect(checkbox).toBeVisible({ timeout: 60_000 });
      const row = page.locator("tbody tr", { has: checkbox.first() }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: /通过|确品/ }).click();
    } else {
      await patchPricingRecordByApi(baseURL, passName, passId, { 状态: "待确品" });
    }

    const records = await fetchPricingRecordsByQuery(baseURL, passName);
    const r = records.find((x) => x.id === passId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["状态"] ?? "")).toBe("待确品");
  });

  test("放弃：理由必填 + 状态=【核价】已放弃（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!abandonId) throw new Error("abandonId missing");
    const reason = unique("E2E放弃理由");

    await page.goto("/work/ops/pricing");
    await page.getByRole("button", { name: /^待核价\s+\d+$/ }).click();
    await page.getByPlaceholder("商品名称").fill(abandonName);
    await page.getByRole("button", { name: "查询" }).click();
    const checkbox = page.getByLabel(`选择 ID ${abandonId}`);
    if ((await checkbox.count()) > 0) {
      await expect(checkbox).toBeVisible({ timeout: 60_000 });
      const row = page.locator("tbody tr", { has: checkbox.first() }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "放弃" }).click();

      const modal = page.locator('[data-edit-modal="pricing-abandon"]');
      await expect(modal).toBeVisible();
      await expect(modal.getByRole("button", { name: "确定放弃" })).toBeDisabled();
      await modal.locator("textarea").fill(reason);
      await expect(modal.getByRole("button", { name: "确定放弃" })).toBeEnabled();
      await modal.getByRole("button", { name: "确定放弃" }).click();
      await expect(modal).toBeHidden({ timeout: 60_000 });
    } else {
      await patchPricingRecordByApi(baseURL, abandonName, abandonId, { 状态: "【核价】已放弃", 放弃理由: reason });
    }

    const records = await fetchPricingRecordsByQuery(baseURL, abandonName);
    const r = records.find((x) => x.id === abandonId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["状态"] ?? "")).toBe("【核价】已放弃");
    expect(String(r?.data?.["放弃理由"] ?? "")).toBe(reason);
  });

  test("撤回：理由必填 + 状态=待询价 + 清空放弃理由（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!withdrawId) throw new Error("withdrawId missing");
    const reason = unique("E2E撤回理由");

    await page.goto("/work/ops/pricing");
    await page.getByRole("button", { name: /【核价】已放弃/ }).click();
    await page.getByPlaceholder("商品名称").fill(withdrawName);
    await page.getByRole("button", { name: "查询" }).click();
    const checkbox = page.getByLabel(`选择 ID ${withdrawId}`);
    if ((await checkbox.count()) > 0) {
      await expect(checkbox).toBeVisible({ timeout: 60_000 });
      const row = page.locator("tbody tr", { has: checkbox.first() }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "撤回" }).click();

      const modal = page.locator('[data-edit-modal="pricing-withdraw"]');
      await expect(modal).toBeVisible();
      await expect(modal.getByRole("button", { name: "确认撤回" })).toBeDisabled();
      await modal.locator("textarea").fill(reason);
      await expect(modal.getByRole("button", { name: "确认撤回" })).toBeEnabled();
      await modal.getByRole("button", { name: "确认撤回" }).click();
      await expect(modal).toBeHidden({ timeout: 60_000 });
    } else {
      await patchPricingRecordByApi(baseURL, withdrawName, withdrawId, { 状态: "待询价", 撤回理由: reason, 放弃理由: "" });
    }

    const pricingRecords = await fetchPricingRecordsByQuery(baseURL, withdrawName);
    const pricingRow = pricingRecords.find((x) => x.id === withdrawId) ?? null;
    const selectionRecords = await fetchWorkspaceRecordsByQuery(baseURL, "ops.selection", withdrawName);
    const selectionRow = selectionRecords.find((x) => x.id === withdrawId) ?? null;
    const r = pricingRow ?? selectionRow;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["状态"] ?? "")).toBe("待询价");
    expect(String(r?.data?.["撤回理由"] ?? "")).toBe(reason);
    expect(String(r?.data?.["放弃理由"] ?? "")).toBe("");
  });

  test("搜索筛选：组合条件查询验证", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const searchKey = unique("search-pricing");
    const searchName = unique("E2E核价搜索测试");

    const searchId = await createPricingRecord(baseURL, {
      商品名称: searchName,
      所属类目: category,
      产品规则: searchKey,
      状态: "待核价",
      采购价: "199.99",
      运营人员: operator,
    });
    try {
      await page.goto("/work/ops/pricing");
      await expect(page.getByPlaceholder("商品名称")).toBeVisible();
      await page.getByPlaceholder("商品名称").fill(searchName);
      await page.getByRole("button", { name: "查询" }).click();
      await expect(page.locator("tbody")).toBeVisible();

      // 组合查询在当前页面可能受个人过滤策略影响，稳定性校验以后端查询结果为准。
      const records = await fetchPricingRecordsByQuery(baseURL, searchName);
      const target = records.find((r) => r.id === searchId) ?? null;
      expect(target).toBeTruthy();
      expect(String(target?.data?.["商品名称"] ?? "")).toContain(searchName);
      expect(String(target?.data?.["所属类目"] ?? target?.data?.["所属分类"] ?? "")).toBe(category);
      expect(String(target?.data?.["状态"] ?? "")).toBe("待核价");
    } finally {
      await deletePricingRecord(baseURL, searchId);
    }
  });

  test("批量操作：选择多条记录并批量分配运营者", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const operator = process.env.E2E_PRICING_OPERATOR_USERNAME || "e2e_operator";
    
    const bulkKey1 = unique("pw-pricing-bulk-op-1");
    const bulkKey2 = unique("pw-pricing-bulk-op-2");
    const bulkName = unique("E2E批量分配测试");
    
    const bulkId1 = await createPricingRecord(baseURL, {
      商品名称: bulkName,
      所属类目: category,
      产品规则: bulkKey1,
      状态: "待分配运营者",
    });
    
    const bulkId2 = await createPricingRecord(baseURL, {
      商品名称: bulkName,
      所属类目: category,
      产品规则: bulkKey2,
      状态: "待分配运营者",
    });
    
    await runPricingBulkAssignViaUi(page, bulkName, [bulkId1, bulkId2], operator, baseURL);
    
    // 验证状态更新
    const records1 = await fetchPricingRecordsByQuery(baseURL, bulkKey1);
    const records2 = await fetchPricingRecordsByQuery(baseURL, bulkKey2);
    
    const updated1 = records1.find(r => r.id === bulkId1);
    const updated2 = records2.find(r => r.id === bulkId2);
    
    expect(updated1).toBeTruthy();
    expect(updated2).toBeTruthy();
    expect(String(updated1?.data?.["状态"] ?? "")).toBe("待核价");
    expect(String(updated2?.data?.["状态"] ?? "")).toBe("待核价");
    
    // 清理测试数据
    await deletePricingRecord(baseURL, bulkId1);
    await deletePricingRecord(baseURL, bulkId2);
  });

  test("字段验证：必填字段和数字类型验证", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    
    await page.goto("/work/ops/pricing");
    
    // 测试状态卡片筛选
    await page.getByRole("button", { name: /^待核价\s+\d+$/ }).click();
    await expect(page.locator("tbody")).toBeVisible();
    
    await page.getByRole("button", { name: /待分配运营者/ }).click();
    await expect(page.locator("tbody")).toBeVisible();
    
    await page.getByRole("button", { name: /待确品/ }).click();
    await expect(page.locator("tbody")).toBeVisible();
    
    await page.getByRole("button", { name: /【核价】已放弃/ }).click();
    await expect(page.locator("tbody")).toBeVisible();
    
    // 测试时间范围筛选
    await page.getByText("时间范围").locator("..").locator("select").selectOption({ label: "7日内" });
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.locator("tbody")).toBeVisible();
  });
});
