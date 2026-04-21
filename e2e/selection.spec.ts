import { expect, test } from "@playwright/test";
import { newAuthedApi } from "./utils/api";

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

async function createSelectionRecord(baseURL: string, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post("/api/workspace/ops.selection/records", { data: { data } });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function fetchSelectionRecordsByQuery(baseURL: string, q: string) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get("/api/workspace/ops.selection/records", {
      params: { q, limit: "200", filters: "{}", timeRange: "" },
    });
    const json = (await res.json()) as { records: { id: number; data: Record<string, unknown> }[] };
    if (!res.ok()) throw new Error(`fetch records failed: ${res.status()} ${JSON.stringify(json)}`);
    return json.records;
  } finally {
    await api.dispose();
  }
}

async function deleteSelectionRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.delete(`/api/workspace/ops.selection/records/${id}`);
    if (!res.ok() && res.status() !== 404) {
      const t = await res.text().catch(() => "");
      throw new Error(`delete record failed: ${res.status()} ${t}`);
    }
  } finally {
    await api.dispose();
  }
}

test.describe.serial("选品页（ops.selection）", () => {
  let category = "";
  let recordCreateUIId: number | null = null;
  let recordEditSubmitId: number | null = null;
  let recordAbandonId: number | null = null;
  let recordNumericTypeId: number | null = null;
  let recordEditSubmitKey = "";
  let recordEditSubmitName = "";
  let recordAbandonKey = "";
  let recordNumericTypeName = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);

    recordEditSubmitKey = unique("pw-product-rule-edit");
    recordEditSubmitName = unique("E2E选品-编辑提交");
    recordEditSubmitId = await createSelectionRecord(baseURL, {
      名称: recordEditSubmitName,
      所属类目: category,
      产品规则: recordEditSubmitKey,
      状态: "待选品",
    });

    recordAbandonKey = unique("pw-product-rule-abandon");
    recordAbandonId = await createSelectionRecord(baseURL, {
      名称: unique("E2E选品-放弃"),
      所属类目: category,
      产品规则: recordAbandonKey,
      状态: "待选品",
    });

    recordNumericTypeName = unique("E2E选品-数字类型测试");
    recordNumericTypeId = await createSelectionRecord(baseURL, {
      名称: recordNumericTypeName,
      所属类目: category,
      产品规则: unique("pw-product-rule-numeric"),
      状态: "待选品",
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const ids = [recordCreateUIId, recordEditSubmitId, recordAbandonId, recordNumericTypeId].filter((v): v is number => typeof v === "number");
    for (const id of ids) await deleteSelectionRecord(baseURL, id);
  });

  test("新增：页面创建并落库（非缓存）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const productName = unique("E2E选品-UI新建");

    const dataReady = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
    );
    await page.goto("/work/ops/selection");
    await dataReady;
    await page.getByRole("button", { name: "新增选品数据" }).click();

    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();

    await modal.locator("div.text-xs.text-muted", { hasText: "商品名称" }).locator("..").locator("input").fill(productName);
    await modal.locator("div.text-xs.text-muted", { hasText: "所属类目" }).locator("..").locator("select").selectOption({ label: category });

    // Register listeners BEFORE clicking save — POST triggers logOperation (first-time compilation),
    // and the subsequent GET reload may also be slow. Both need extended timeouts.
    const postDone = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "POST",
      { timeout: 120_000 },
    );
    await modal.getByRole("button", { name: "保存" }).click();
    await postDone;
    await expect(modal).toBeHidden({ timeout: 60_000 });
    // Wait for the post-save load() to complete: button enabled = loading=false
    await expect(page.getByRole("button", { name: "查询" })).toBeEnabled({ timeout: 120_000 });

    // Verify via API first (direct DB query, no UI filter dependency)
    const records = await fetchSelectionRecordsByQuery(baseURL, productName);
    const created =
      records
        .filter((r) => String((r.data as Record<string, unknown>)["名称"] ?? "") === productName)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
    expect(created).toBeTruthy();
    if (!created) return;
    recordCreateUIId = created.id;
    expect(String(created.data["名称"] ?? "")).toBe(productName);
    expect(String(created.data["所属类目"] ?? "")).toBe(category);
    expect(String(created.data["状态"] ?? "")).toBe("待选品");

    // Verify the record appears in the UI (search + table check)
    const searchDone = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
      { timeout: 60_000 },
    );
    await page.getByPlaceholder("商品名称").fill(productName);
    await page.getByRole("button", { name: "查询" }).click();
    await searchDone;
    await expect(page.locator("tbody")).toContainText(productName, { timeout: 30_000 });

    const state = await page.context().storageState();
    const fresh = await page.context().browser()?.newContext({ storageState: state });
    if (!fresh) throw new Error("browser context missing");
    const p2 = await fresh.newPage();
    await p2.goto("/work/ops/selection");
    await p2.getByPlaceholder("商品名称").fill(productName);
    await p2.getByRole("button", { name: "查询" }).click();
    await expect(p2.locator("tbody")).toContainText(productName);
    await fresh.close();
  });

  test("编辑保存+提交：状态流转与字段持久化", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!recordEditSubmitId) throw new Error("recordEditSubmitId missing");

    const records0 = await fetchSelectionRecordsByQuery(baseURL, recordEditSubmitKey);
    const row0 = records0.find((r) => r.id === recordEditSubmitId) ?? null;
    expect(row0).toBeTruthy();
    const name = String(row0?.data?.["名称"] ?? "");

    const initialLoad = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
    );
    await page.goto("/work/ops/selection");
    await initialLoad;
    await page.getByPlaceholder("商品名称").fill(name);
    const searchDone = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "查询" }).click();
    await searchDone;

    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "修改" }).click();

    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();

    const note = unique("note");
    await modal.locator("div.text-xs.text-muted", { hasText: "资质要求" }).locator("..").locator("input").fill(note);

    // PATCH to records/[id] may be first-time compilation — use long timeouts
    const patchDone = page.waitForResponse(
      (r) => /\/api\/workspace\/ops\.selection\/records\/\d+/.test(r.url()) && r.request().method() === "PATCH",
      { timeout: 120_000 },
    );
    const reloadAfterSave = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
      { timeout: 120_000 },
    );
    await modal.getByRole("button", { name: "保存" }).click();
    await patchDone;
    await expect(modal).toBeHidden();
    await reloadAfterSave;

    const records1 = await fetchSelectionRecordsByQuery(baseURL, recordEditSubmitName);
    const row1 = records1.find((r) => r.id === recordEditSubmitId) ?? null;
    expect(row1).toBeTruthy();
    expect(String(row1?.data?.["资质要求"] ?? "")).toBe(note);

    await row.getByRole("button", { name: "修改" }).click();
    await expect(modal).toBeVisible();
    const submitPatch = page.waitForResponse(
      (r) => /\/api\/workspace\/ops\.selection\/records\/\d+/.test(r.url()) && r.request().method() === "PATCH",
    );
    const reloadAfterSubmit = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
    );
    await modal.getByRole("button", { name: "提交" }).click();
    await submitPatch;
    await expect(modal).toBeHidden();
    await reloadAfterSubmit;

    const records2 = await fetchSelectionRecordsByQuery(baseURL, recordEditSubmitName);
    const row2 = records2.find((r) => r.id === recordEditSubmitId) ?? null;
    expect(row2).toBeTruthy();
    expect(String(row2?.data?.["状态"] ?? "")).toBe("待分配【询价】");
  });

  test("放弃：按钮禁用规则+理由必填+落库", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!recordAbandonId) throw new Error("recordAbandonId missing");

    const records0 = await fetchSelectionRecordsByQuery(baseURL, recordAbandonKey);
    const row0 = records0.find((r) => r.id === recordAbandonId) ?? null;
    expect(row0).toBeTruthy();
    const name = String(row0?.data?.["名称"] ?? "");

    await page.goto("/work/ops/selection");
    await page.getByPlaceholder("商品名称").fill(name);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "放弃" }).click();

    const modal = page.locator('[data-edit-modal="selection-abandon"]');
    await expect(modal).toBeVisible();

    await expect(modal.getByRole("button", { name: "确定放弃" })).toBeDisabled();
    const reason = unique("reason");
    await modal.locator("textarea").fill(reason);
    await expect(modal.getByRole("button", { name: "确定放弃" })).toBeEnabled();
    await modal.getByRole("button", { name: "确定放弃" }).click();
    await expect(modal).toBeHidden();

    const records1 = await fetchSelectionRecordsByQuery(baseURL, recordAbandonKey);
    const row1 = records1.find((r) => r.id === recordAbandonId) ?? null;
    expect(row1).toBeTruthy();
    expect(String(row1?.data?.["状态"] ?? "")).toBe("【选品】已放弃");
    expect(String(row1?.data?.["放弃理由"] ?? "")).toBe(reason);
  });

  test("新增：商品名称为空时阻止保存", async ({ page }) => {
    await page.goto("/work/ops/selection");
    await page.getByRole("button", { name: "新增选品数据" }).click();

    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();

    // 不填商品名称，直接点保存；拦截 alert 并关闭
    page.once("dialog", (d) => d.dismiss());
    await modal.getByRole("button", { name: "保存" }).click();

    // 弹窗应仍可见（必填校验阻止了关闭）
    await expect(modal).toBeVisible();

    // 清理：关闭弹窗
    await modal.getByRole("button", { name: "取消" }).click();
    await expect(modal).toBeHidden();
  });

  test("修改弹窗：建议采购价和平台在售价格为数字输入框", async ({ page }) => {
    if (!recordNumericTypeId) throw new Error("recordNumericTypeId missing");

    await page.goto("/work/ops/selection");
    await page.getByPlaceholder("商品名称").fill(recordNumericTypeName);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { hasText: recordNumericTypeName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();

    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();

    // 建议采购价（选品逻辑块）
    const purchasePriceInput = modal
      .locator("div.text-xs.text-muted", { hasText: "建议采购价" })
      .locator("..")
      .locator("input");
    await expect(purchasePriceInput).toHaveAttribute("type", "number");

    // 平台在售价格 Min（基本信息块）
    const minPriceInput = modal
      .locator("div.text-xs.text-muted", { hasText: "平台在售价格" })
      .locator("..")
      .locator("input")
      .first();
    await expect(minPriceInput).toHaveAttribute("type", "number");

    await modal.getByRole("button", { name: "取消" }).click();
    await expect(modal).toBeHidden();
  });

  test("批量操作：选择多条记录并批量提交", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    
    // 创建两条测试记录用于批量操作
    const bulkKey1 = unique("pw-bulk-op-1");
    const bulkKey2 = unique("pw-bulk-op-2");
    const bulkName1 = unique("E2E批量操作-1");
    const bulkName2 = unique("E2E批量操作-2");
    
    const bulkId1 = await createSelectionRecord(baseURL, {
      名称: bulkName1,
      所属类目: category,
      产品规则: bulkKey1,
      状态: "待选品",
    });
    
    const bulkId2 = await createSelectionRecord(baseURL, {
      名称: bulkName2,
      所属类目: category,
      产品规则: bulkKey2,
      状态: "待选品",
    });

    await page.goto("/work/ops/selection");
    await page.getByPlaceholder("商品名称").fill(bulkKey1);
    await page.getByRole("button", { name: "查询" }).click();

    // 选择两条记录
    await page.getByLabel(`选择 ID ${bulkId1}`).check();
    await page.getByLabel(`选择 ID ${bulkId2}`).check();

    // 执行批量提交操作
    const submitBtn = page.getByRole("button", { name: "批量提交" });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 等待批量操作完成
    const bulkResponse = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records/batch") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await bulkResponse;

    // 验证状态更新
    const records1 = await fetchSelectionRecordsByQuery(baseURL, bulkKey1);
    const records2 = await fetchSelectionRecordsByQuery(baseURL, bulkKey2);
    
    const updated1 = records1.find(r => r.id === bulkId1);
    const updated2 = records2.find(r => r.id === bulkId2);
    
    expect(updated1).toBeTruthy();
    expect(updated2).toBeTruthy();
    expect(String(updated1?.data?.["状态"] ?? "")).toBe("待分配【询价】");
    expect(String(updated2?.data?.["状态"] ?? "")).toBe("待分配【询价】");

    // 清理测试数据
    await deleteSelectionRecord(baseURL, bulkId1);
    await deleteSelectionRecord(baseURL, bulkId2);
  });

  test("搜索筛选：组合条件查询验证", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    
    const searchKey = unique("search-test");
    const searchName = unique("E2E搜索测试");
    
    const searchId = await createSelectionRecord(baseURL, {
      名称: searchName,
      所属类目: category,
      产品规则: searchKey,
      状态: "待选品",
      采购价: "99.9",
    });

    await page.goto("/work/ops/selection");
    
    // 测试关键词搜索
    await page.getByPlaceholder("商品名称").fill(searchName);
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.locator("tbody")).toContainText(searchName);

    // 测试类目筛选
    await page.getByPlaceholder("商品名称").fill("");
    await page.locator("select").first().selectOption(category);
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.locator("tbody")).toContainText(searchName);

    // 测试状态筛选
    await page.locator("select").nth(1).selectOption("待选品");
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.locator("tbody")).toContainText(searchName);

    // 验证搜索结果准确性
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(1);

    // 清理测试数据
    await deleteSelectionRecord(baseURL, searchId);
  });

  test("字段验证：必填字段和数字类型验证", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    
    await page.goto("/work/ops/selection");
    await page.getByRole("button", { name: "新增选品数据" }).click();

    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();

    // 测试必填字段验证
    const saveButton = modal.getByRole("button", { name: "保存" });
    await saveButton.click();
    
    // 验证必填字段错误提示
    await expect(modal.locator("text=商品名称不能为空")).toBeVisible();
    await expect(modal.locator("text=所属类目不能为空")).toBeVisible();

    // 填写必填字段
    await modal.locator("div.text-xs.text-muted", { hasText: "商品名称" }).locator("..").locator("input").fill("测试商品");
    await modal.locator("div.text-xs.text-muted", { hasText: "所属类目" }).locator("..").locator("select").selectOption({ label: category });

    // 测试数字字段验证
    const priceInput = modal.locator("div.text-xs.text-muted", { hasText: "采购价" }).locator("..").locator("input");
    await priceInput.fill("abc");
    await saveButton.click();
    
    // 验证数字字段错误提示
    await expect(modal.locator("text=请输入有效的数字")).toBeVisible();

    // 修正为有效数字
    await priceInput.fill("100");
    
    await modal.getByRole("button", { name: "取消" }).click();
    await expect(modal).toBeHidden();
  });
});
