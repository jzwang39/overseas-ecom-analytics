import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newAuthedApi } from "./utils/api";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type WorkspaceKey = "ops.selection" | "ops.inquiry" | "ops.pricing" | "ops.confirm" | "ops.purchase";

type RoleState = {
  admin: string;
  inquiry: string;
  operator: string;
};

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

async function createRecord(baseURL: string, key: WorkspaceKey, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post(`/api/workspace/${key}/records`, { data: { data } });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function deleteRecord(baseURL: string, key: WorkspaceKey, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.delete(`/api/workspace/${key}/records/${id}`);
    if (!res.ok() && res.status() !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`delete record failed: ${res.status()} ${text}`);
    }
  } finally {
    await api.dispose();
  }
}

async function runAs(
  browser: Browser,
  baseURL: string,
  storageState: string,
  fn: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ baseURL, storageState });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function searchByName(page: Page, workspacePath: string, name: string) {
  await page.goto(workspacePath);
  await page.getByPlaceholder(/商品名称/).fill(name);
  await page.getByRole("button", { name: "查询" }).click();
}

async function toggleHistory(page: Page, key: WorkspaceKey) {
  const historyResponse = page.waitForResponse(
    (r) => r.url().includes(`/api/workspace/${key}/records?myHistory=true`) && r.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "查看历史数据" }).click();
  const response = await historyResponse;
  await expect(page.getByRole("button", { name: "退出历史数据" })).toBeVisible();
  const json = (await response.json()) as { records?: Array<{ id: number; data: Record<string, unknown> }> };
  return Array.isArray(json.records) ? json.records : [];
}

async function exitHistory(page: Page) {
  await page.getByRole("button", { name: "退出历史数据" }).click();
  await expect(page.getByRole("button", { name: "查看历史数据" })).toBeVisible();
}

test.describe.serial("工作台历史数据与媒体交互", () => {
  let category = "";
  let roleState: RoleState;
  let inquiryUsername = "";
  let operatorUsername = "";

  let selectionHistoryId: number | null = null;
  let selectionHistoryName = "";
  let inquiryHistoryId: number | null = null;
  let inquiryHistoryName = "";
  let pricingHistoryId: number | null = null;
  let pricingHistoryName = "";
  let confirmHistoryId: number | null = null;
  let confirmHistoryName = "";
  let purchaseHistoryId: number | null = null;
  let purchaseHistoryName = "";
  let mediaRecordId: number | null = null;
  let mediaRecordName = "";
  let emptyRecordId: number | null = null;
  let emptyRecordName = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);

    const authDir = path.join(process.cwd(), "e2e", ".auth");
    roleState = {
      admin: path.join(authDir, "storage.json"),
      inquiry: path.join(authDir, "inquiry.json"),
      operator: path.join(authDir, "operator.json"),
    };
    await Promise.all([fs.access(roleState.admin), fs.access(roleState.inquiry), fs.access(roleState.operator)]);

    inquiryUsername = process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry";
    operatorUsername = process.env.E2E_PRICING_OPERATOR_USERNAME || "e2e_operator";

    selectionHistoryName = unique("E2E历史-选品");
    selectionHistoryId = await createRecord(baseURL, "ops.selection", {
      名称: selectionHistoryName,
      所属类目: category,
      产品规则: unique("pw-history-selection"),
      状态: "待选品",
    });

    inquiryHistoryName = unique("E2E历史-询价");
    inquiryHistoryId = await createRecord(baseURL, "ops.inquiry", {
      名称: inquiryHistoryName,
      所属类目: category,
      产品规则: unique("pw-history-inquiry"),
      状态: "待询价",
      询价人: inquiryUsername,
    });

    pricingHistoryName = unique("E2E历史-核价");
    pricingHistoryId = await createRecord(baseURL, "ops.pricing", {
      名称: pricingHistoryName,
      所属类目: category,
      产品规则: unique("pw-history-pricing"),
      状态: "待核价",
      运营人员: operatorUsername,
    });

    confirmHistoryName = unique("E2E历史-确品");
    confirmHistoryId = await createRecord(baseURL, "ops.confirm", {
      名称: confirmHistoryName,
      所属类目: category,
      产品规则: unique("pw-history-confirm"),
      状态: "待确品",
    });

    purchaseHistoryName = unique("E2E历史-采购");
    purchaseHistoryId = await createRecord(baseURL, "ops.purchase", {
      名称: purchaseHistoryName,
      所属类目: category,
      产品规则: unique("pw-history-purchase"),
      状态: "待采购",
    });

    mediaRecordName = unique("E2E媒体交互");
    mediaRecordId = await createRecord(baseURL, "ops.selection", {
      名称: mediaRecordName,
      所属类目: category,
      产品规则: unique("pw-media-selection"),
      状态: "待选品",
      产品图片: "/uploads/e2e-preview-1.png,/uploads/e2e-preview-2.png",
      参考链接: "https://example.com/product-a,https://example.com/product-b",
    });

    emptyRecordName = unique("E2E空数据");
    emptyRecordId = await createRecord(baseURL, "ops.selection", {
      名称: emptyRecordName,
      所属类目: category,
      产品规则: unique("pw-empty-selection"),
      状态: "待选品",
      产品图片: "",
      参考链接: "",
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const deletions: Array<[WorkspaceKey, number | null]> = [
      ["ops.selection", selectionHistoryId],
      ["ops.inquiry", inquiryHistoryId],
      ["ops.pricing", pricingHistoryId],
      ["ops.confirm", confirmHistoryId],
      ["ops.purchase", purchaseHistoryId],
      ["ops.selection", mediaRecordId],
      ["ops.selection", emptyRecordId],
    ];
    for (const [key, id] of deletions) {
      if (id != null) await deleteRecord(baseURL, key, id);
    }
  });

  test("P1：选品工作台查看历史数据切换与数据正确性", async ({ page }) => {
    if (!selectionHistoryId) throw new Error("selection history data missing");

    await searchByName(page, "/work/ops/selection", selectionHistoryName);
    const historyRecords = await toggleHistory(page, "ops.selection");
    expect(historyRecords.some((r) => r.id === selectionHistoryId && String(r.data?.["名称"] ?? "") === selectionHistoryName)).toBeTruthy();
    await expect(page.locator("tbody")).toContainText(selectionHistoryName);
    await exitHistory(page);
  });

  test("P1：询价工作台查看历史数据切换与数据正确性", async ({ browser, baseURL }) => {
    if (!baseURL || !inquiryHistoryId) throw new Error("inquiry history data missing");
    await runAs(browser, baseURL, roleState.inquiry, async (page) => {
      await searchByName(page, "/work/ops/inquiry", inquiryHistoryName);
      await page.getByLabel(`选择 ID ${inquiryHistoryId}`).check();
      await page.getByRole("button", { name: /批量修改数据/ }).click();
      const modal = page.locator('[data-edit-modal="inquiry-bulk-edit"]');
      await expect(modal).toBeVisible();
      await modal.getByText("产品单价", { exact: true }).locator("..").locator("input").fill("18.8");
      await modal.getByText("起订量", { exact: true }).locator("..").locator("input").fill("60");
      await modal.getByRole("button", { name: "提交" }).click();
      await expect(modal).toBeHidden({ timeout: 60_000 });

      await page.getByPlaceholder(/商品名称/).fill(inquiryHistoryName);
      await page.getByRole("button", { name: "查询" }).click();
      const historyRecords = await toggleHistory(page, "ops.inquiry");
      expect(historyRecords.some((r) => r.id === inquiryHistoryId && String(r.data?.["状态"] ?? "") === "待分配运营者")).toBeTruthy();
      await expect(page.locator("tbody")).toContainText(inquiryHistoryName);
      await expect(page.locator("tbody")).toContainText("待分配运营者");
      await exitHistory(page);
    });
  });

  test("P1：核价工作台查看历史数据切换与数据正确性", async ({ browser, baseURL }) => {
    if (!baseURL || !pricingHistoryId) throw new Error("pricing history data missing");
    await runAs(browser, baseURL, roleState.operator, async (page) => {
      await searchByName(page, "/work/ops/pricing", pricingHistoryName);
      const row = page.locator("tbody tr", { hasText: pricingHistoryName }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "通过" }).click();

      await page.getByPlaceholder(/商品名称/).fill(pricingHistoryName);
      await page.getByRole("button", { name: "查询" }).click();
      const historyRecords = await toggleHistory(page, "ops.pricing");
      expect(historyRecords.some((r) => r.id === pricingHistoryId && String(r.data?.["状态"] ?? "") === "待确品")).toBeTruthy();
      await expect(page.locator("tbody")).toContainText(pricingHistoryName);
      await expect(page.locator("tbody")).toContainText("待确品");
      await exitHistory(page);
    });
  });

  test("P1：确品工作台查看历史数据切换与数据正确性", async ({ page }) => {
    if (!confirmHistoryId) throw new Error("confirm history data missing");
    await searchByName(page, "/work/ops/confirm", confirmHistoryName);
    const row = page.locator("tbody tr", { hasText: confirmHistoryName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();
    const modal = page.locator('[data-edit-modal="default"]');
    await expect(modal).toBeVisible();
    await modal.getByText("平台在售价格区间", { exact: true }).locator("..").getByRole("spinbutton").nth(0).fill("15.5");
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();

    await page.getByPlaceholder(/商品名称/).fill(confirmHistoryName);
    await page.getByRole("button", { name: "查询" }).click();
    const historyRecords = await toggleHistory(page, "ops.confirm");
    expect(historyRecords.some((r) => r.id === confirmHistoryId && String(r.data?.["状态"] ?? "") === "待采购")).toBeTruthy();
    await expect(page.locator("tbody")).toContainText(confirmHistoryName);
    await expect(page.locator("tbody")).toContainText("待采购");
    await exitHistory(page);
  });

  test("P1：采购工作台查看历史数据切换与数据正确性", async ({ page }) => {
    if (!purchaseHistoryId) throw new Error("purchase history data missing");
    await searchByName(page, "/work/ops/purchase", purchaseHistoryName);
    const row = page.locator("tbody tr", { hasText: purchaseHistoryName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();
    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();
    await modal.getByText("货物（¥）", { exact: true }).locator("..").locator("input").fill("88.8");
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();

    await page.getByPlaceholder(/商品名称/).fill(purchaseHistoryName);
    await page.getByRole("button", { name: "查询" }).click();
    const historyRecords = await toggleHistory(page, "ops.purchase");
    expect(historyRecords.some((r) => r.id === purchaseHistoryId && String(r.data?.["状态"] ?? "") === "待发货")).toBeTruthy();
    await expect(page.locator("tbody")).toContainText(purchaseHistoryName);
    await expect(page.locator("tbody")).toContainText("待发货");
    await exitHistory(page);
  });

  test("P2：图片预览交互支持翻页与缩略图切换", async ({ page }) => {
    if (!mediaRecordId) throw new Error("media record missing");
    await searchByName(page, "/work/ops/selection", mediaRecordName);
    const row = page.locator("tbody tr", { hasText: mediaRecordName }).first();
    await expect(row).toBeVisible();
    await row.locator("div.cursor-pointer").first().click();

    await expect(page.getByText("图片预览（1/2）")).toBeVisible();
    await expect(page.getByRole("img", { name: "图片预览" })).toBeVisible();
    await page.getByRole("button", { name: "下一张" }).click();
    await expect(page.getByText("图片预览（2/2）")).toBeVisible();
    await page.getByRole("button", { name: "查看第 1 张" }).click();
    await expect(page.getByText("图片预览（1/2）")).toBeVisible();
    await page.getByTitle("关闭").click();
    await expect(page.getByText("图片预览（1/2）")).toBeHidden();
  });

  test("P2：参考链接点击可打开新窗口并跳转正确地址", async ({ page }) => {
    await searchByName(page, "/work/ops/selection", mediaRecordName);
    const row = page.locator("tbody tr", { hasText: mediaRecordName }).first();
    await expect(row).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      row.getByRole("link", { name: "链接" }).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe("https://example.com/product-a");
    await popup.close();
  });

  test("P2：异常空数据场景展示占位且查询无结果不报错", async ({ page }) => {
    if (!emptyRecordId) throw new Error("empty record missing");
    await searchByName(page, "/work/ops/selection", emptyRecordName);
    const row = page.locator("tbody tr", { hasText: emptyRecordName }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("—");

    await page.getByPlaceholder(/商品名称/).fill(unique("不存在"));
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.locator("tbody")).toContainText("暂无数据");
  });
});
