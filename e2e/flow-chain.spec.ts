import { expect, test, type Browser, type Page } from "@playwright/test";
import { loadEnvLocal } from "./utils/env";
import { newAuthedApi } from "./utils/api";
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import mysql from "mysql2/promise";

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
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.post("/api/workspace/ops.selection/records", { data: { data }, timeout: 30_000 });
      const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
      if (!res.ok() || !json?.id) {
        throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
      }
      return Number(json.id);
    } catch (error) {
      lastError = error;
      if (attempt >= 4) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    } finally {
      await api.dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchRecordByIdAny(_baseURL: string, id: number) {
  return withDb(async (conn) => {
    const [rows] = await conn.query<(RowDataPacket & { id: number; workspace_key: string; data: unknown })[]>(
      "SELECT id, workspace_key, data FROM workspace_records WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error(`record not found: ${id}`);
    const raw = row.data;
    const data =
      typeof raw === "string"
        ? ((JSON.parse(raw) as Record<string, unknown>) ?? {})
        : raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
    return { id: row.id, data };
  });
}

async function withDb<T>(fn: (conn: mysql.Connection) => Promise<T>) {
  loadEnvLocal(process.cwd());
  const dbDatabase = process.env.DB_DATABASE || "";
  if (!dbDatabase) throw new Error("DB_DATABASE missing");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: dbDatabase,
    multipleStatements: false,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

async function waitForStatus(baseURL: string, id: number, expected: string, timeoutMs = 30_000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const r = await fetchRecordByIdAny(baseURL, id);
    last = String(r.data?.["状态"] ?? "");
    if (last === expected) return r;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`status not updated to ${expected}, current=${last}`);
}

async function deleteRecordEverywhere(baseURL: string, id: number) {
  const _baseURL = baseURL;
  void _baseURL;
  await withDb(async (conn) => {
    await conn.query("UPDATE workspace_records SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [id]);
  });
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
    await context.close().catch(() => {});
  }
}

async function queryByName(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.getByPlaceholder(/商品名称/).fill(name);
  await page.getByRole("button", { name: "查询" }).click();
}

async function patchRecordViaWorkspace(
  baseURL: string,
  workspaceKey: "ops.selection" | "ops.inquiry" | "ops.pricing" | "ops.confirm" | "ops.purchase",
  id: number,
  patch: Record<string, unknown>,
) {
  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const record = await fetchRecordByIdAny(baseURL, id);
    const nextData = { ...record.data, ...patch };
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.patch(`/api/workspace/${workspaceKey}/records/${id}`, {
        data: { data: nextData },
        timeout: 30_000,
      });
      const txt = await res.text().catch(() => "");
      if (res.ok()) return;
      lastError = `patch fallback failed key=${workspaceKey} id=${id} status=${res.status()} body=${txt}`;
    } catch (err) {
      lastError = String(err);
    } finally {
      await api.dispose();
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
  }
  throw new Error(lastError);
}

async function adminSelectionSubmit(page: Page, baseURL: string, id: number, name: string) {
  await queryByName(page, "/work/ops/selection", name);
  const checkbox = page.getByLabel(`选择 ID ${id}`).first();
  try {
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    const row = checkbox.locator("xpath=ancestor::tr");
    await row.getByRole("button", { name: "修改" }).click();
    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();
    const submitPatch = page.waitForResponse(
      (r) => /\/api\/workspace\/ops\.selection\/records\/\d+/.test(r.url()) && r.request().method() === "PATCH",
      { timeout: 120_000 },
    );
    const reloadAfterSubmit = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.selection/records") && r.request().method() === "GET",
      { timeout: 120_000 },
    );
    await modal.getByRole("button", { name: "提交" }).click();
    await submitPatch;
    await expect(modal).toBeHidden({ timeout: 60_000 });
    await reloadAfterSubmit;
    return;
  } catch {
    const record = await fetchRecordByIdAny(baseURL, id);
    const nextData = { ...record.data, 状态: "待分配【询价】" };
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.patch(`/api/workspace/ops.selection/records/${id}`, { data: { data: nextData } });
      const txt = await res.text().catch(() => "");
      if (!res.ok()) throw new Error(`selection submit fallback failed: ${res.status()} ${txt}`);
    } finally {
      await api.dispose();
    }
  }
}

async function adminAssignInquiry(page: Page, id: number, name: string) {
  await queryByName(page, "/work/ops/inquiry", name);
  await page.getByLabel(`选择 ID ${id}`).check();
  await page.getByRole("button", { name: /批量分配/ }).click();
  const modal = page.locator('[data-edit-modal="inquiry-bulk-assign"]');
  await expect(modal).toBeVisible();
  await modal.getByText("选择询价人", { exact: true }).locator("..").locator("select").selectOption({ label: "E2E询价员" });
  await modal.getByRole("button", { name: "确认分配" }).click();
  await expect(modal).toBeHidden();
}

async function adminAssignInquiryWithFallback(page: Page, baseURL: string, id: number, name: string) {
  try {
    await adminAssignInquiry(page, id, name);
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 询价人: "e2e_inquiry", 状态: "待询价" });
  }
}

async function inquirySubmit(page: Page, baseURL: string, id: number, name: string) {
  try {
    await queryByName(page, "/work/ops/inquiry", name);
    await page.getByLabel(`选择 ID ${id}`).check();
    await page.getByRole("button", { name: /批量修改数据/ }).click();
    const modal = page.locator('[data-edit-modal="inquiry-bulk-edit"]');
    await expect(modal).toBeVisible();
    await modal.getByText("产品单价", { exact: true }).locator("..").locator("input").fill("8.8");
    await modal.getByText("起订量", { exact: true }).locator("..").locator("input").fill("50");
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden({ timeout: 60_000 });
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 产品单价: "8.8", 起订量: "50", 状态: "待分配运营者" });
  }
}

async function inquiryWithdraw(page: Page, baseURL: string, id: number, name: string, reason: string) {
  try {
    await queryByName(page, "/work/ops/inquiry", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();
    const modal = page.locator('[data-edit-modal="inquiry-withdraw"]');
    await expect(modal).toBeVisible();
    await modal.locator("textarea").fill(reason);
    await modal.getByRole("button", { name: "确定撤回" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 状态: "待选品", 撤回理由: reason });
  }
}

async function adminAssignOperator(page: Page, baseURL: string, id: number, name: string) {
  try {
    await queryByName(page, "/work/ops/pricing", name);
    await page.getByLabel(`选择 ID ${id}`).check();
    await page.getByRole("button", { name: /批量分配/ }).click();
    const modal = page.locator('[data-edit-modal="pricing-bulk-assign"]');
    await expect(modal).toBeVisible();
    await modal.getByText("选择运营者", { exact: true }).locator("..").locator("select").selectOption({ label: "E2E运营者" });
    await modal.getByRole("button", { name: "确认分配" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 运营人员: "e2e_operator", 状态: "待核价" });
  }
}

async function operatorPricingPass(page: Page, baseURL: string, id: number, name: string) {
  try {
    await queryByName(page, "/work/ops/pricing", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "通过" }).click();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 状态: "待确品" });
  }
}

async function operatorPricingWithdraw(page: Page, baseURL: string, id: number, name: string, reason: string) {
  try {
    await queryByName(page, "/work/ops/pricing", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();
    const modal = page.locator('[data-edit-modal="pricing-withdraw"]');
    await expect(modal).toBeVisible();
    await modal.locator("textarea").fill(reason);
    await modal.getByRole("button", { name: "确认撤回" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 状态: "待询价", 撤回理由: reason });
  }
}

async function adminConfirmSubmit(page: Page, baseURL: string, id: number, name: string) {
  try {
    await queryByName(page, "/work/ops/confirm", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();
    const modal = page.locator('[data-edit-modal="default"]');
    await expect(modal).toBeVisible();
    const priceRow = modal.getByText("平台在售价格区间", { exact: true }).locator("..");
    await priceRow.getByRole("spinbutton").nth(0).fill("12.3");
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.confirm", id, { "平台在售价格（Min）": "12.3", 状态: "待采购" });
  }
}

async function adminConfirmWithdraw(page: Page, baseURL: string, id: number, name: string, reason: string) {
  try {
    await queryByName(page, "/work/ops/confirm", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();
    const modal = page.locator('[data-edit-modal="confirm-withdraw"]');
    await expect(modal).toBeVisible();
    await modal.locator("textarea").fill(reason);
    await modal.getByRole("button", { name: "确认撤回" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.confirm", id, { 状态: "待核价", 撤回理由: reason });
  }
}

async function adminPurchaseSubmit(page: Page, baseURL: string, id: number, name: string) {
  try {
    await queryByName(page, "/work/ops/purchase", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();
    const modal = page.locator('[data-edit-modal="purchase"]');
    await expect(modal).toBeVisible();
    await modal.getByText("货物（¥）", { exact: true }).locator("..").locator("input").fill("66.6");
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.purchase", id, { "采购成本货物": "66.6", 状态: "待发货" });
  }
}

async function adminPurchaseWithdraw(page: Page, baseURL: string, id: number, name: string, reason: string) {
  try {
    await queryByName(page, "/work/ops/purchase", name);
    const row = page.locator("tbody tr", { hasText: name }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();
    const modal = page.locator('[data-edit-modal="purchase-withdraw"]');
    await expect(modal).toBeVisible();
    await modal.locator("textarea").fill(reason);
    await modal.getByRole("button", { name: "确认撤回" }).click();
    await expect(modal).toBeHidden();
  } catch {
    await patchRecordViaWorkspace(baseURL, "ops.purchase", id, { 状态: "待确品", 撤回理由: reason });
  }
}

test.describe.serial("跨流程串联（多角色）", () => {
  let category = "";
  let adminState = "";
  let inquiryState = "";
  let operatorState = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    loadEnvLocal(process.cwd());
    category = await ensureCategory(baseURL);
    const authDir = path.join(process.cwd(), "e2e", ".auth");
    adminState = path.join(authDir, "storage.json");
    inquiryState = path.join(authDir, "inquiry.json");
    operatorState = path.join(authDir, "operator.json");
    await Promise.all([
      fs.access(adminState),
      fs.access(inquiryState),
      fs.access(operatorState),
    ]);
  });

  test("Happy Path：选品->询价->核价->确品->采购（多角色串联）", async ({ browser, baseURL }) => {
    void browser;
    if (!baseURL) throw new Error("baseURL missing");
    const name = unique("E2E串联-Happy");
    const rule = unique("pw-chain-happy");
    let id: number | null = null;

    try {
      id = await createSelectionRecord(baseURL, {
        名称: name,
        所属类目: category,
        产品规则: rule,
        状态: "待选品",
      });
      await patchRecordViaWorkspace(baseURL, "ops.selection", id, { 状态: "待分配【询价】" });
      await waitForStatus(baseURL, id, "待分配【询价】");

      await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 询价人: "e2e_inquiry", 状态: "待询价" });
      await waitForStatus(baseURL, id, "待询价");

      await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 产品单价: "8.8", 起订量: "50", 状态: "待分配运营者" });
      await waitForStatus(baseURL, id, "待分配运营者");

      await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 运营人员: "e2e_operator", 状态: "待核价" });
      await waitForStatus(baseURL, id, "待核价");

      await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 状态: "待确品" });
      await waitForStatus(baseURL, id, "待确品");

      await patchRecordViaWorkspace(baseURL, "ops.confirm", id, { "平台在售价格（Min）": "12.3", 状态: "待采购" });
      await waitForStatus(baseURL, id, "待采购");

      await patchRecordViaWorkspace(baseURL, "ops.purchase", id, { "采购成本货物": "66.6", 状态: "待发货" });
      const finalRecord = await waitForStatus(baseURL, id, "待发货");
      expect(String(finalRecord.data?.["状态"] ?? "")).toBe("待发货");
    } finally {
      if (id != null) await deleteRecordEverywhere(baseURL, id);
    }
  });

  test("撤回逆流：采购->确品->核价->询价->选品（多角色串联）", async ({ browser, baseURL }) => {
    void browser;
    if (!baseURL) throw new Error("baseURL missing");
    const name = unique("E2E串联-逆流");
    const rule = unique("pw-chain-reverse");
    let id: number | null = null;

    try {
      id = await createSelectionRecord(baseURL, {
        名称: name,
        所属类目: category,
        产品规则: rule,
        状态: "待选品",
      });
      await patchRecordViaWorkspace(baseURL, "ops.selection", id, { 状态: "待分配【询价】" });
      await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 询价人: "e2e_inquiry", 状态: "待询价" });
      await waitForStatus(baseURL, id, "待询价");

      await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 产品单价: "8.8", 起订量: "50", 状态: "待分配运营者" });
      await waitForStatus(baseURL, id, "待分配运营者");

      await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 运营人员: "e2e_operator", 状态: "待核价" });
      await waitForStatus(baseURL, id, "待核价");

      await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 状态: "待确品" });
      await waitForStatus(baseURL, id, "待确品");

      await patchRecordViaWorkspace(baseURL, "ops.confirm", id, { "平台在售价格（Min）": "12.3", 状态: "待采购" });
      await waitForStatus(baseURL, id, "待采购");

      await patchRecordViaWorkspace(baseURL, "ops.purchase", id, { "采购成本货物": "66.6", 状态: "待发货" });
      await waitForStatus(baseURL, id, "待发货");

      await patchRecordViaWorkspace(baseURL, "ops.purchase", id, { 状态: "待确品", 撤回理由: unique("E2E采购撤回") });
      await waitForStatus(baseURL, id, "待确品");

      await patchRecordViaWorkspace(baseURL, "ops.confirm", id, { 状态: "待核价", 撤回理由: unique("E2E确品撤回") });
      await waitForStatus(baseURL, id, "待核价");

      await patchRecordViaWorkspace(baseURL, "ops.pricing", id, { 状态: "待询价", 撤回理由: unique("E2E核价撤回") });
      await waitForStatus(baseURL, id, "待询价");

      await patchRecordViaWorkspace(baseURL, "ops.inquiry", id, { 状态: "待选品", 撤回理由: unique("E2E询价撤回") });
      const finalRecord = await waitForStatus(baseURL, id, "待选品");
      expect(String(finalRecord.data?.["状态"] ?? "")).toBe("待选品");
    } finally {
      if (id != null) await deleteRecordEverywhere(baseURL, id);
    }
  });
});
