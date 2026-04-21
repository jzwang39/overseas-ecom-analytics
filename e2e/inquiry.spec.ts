import { expect, request, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import mysql from "mysql2/promise";
import { loadEnvLocal } from "./utils/env";
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

async function createInquiryRecord(baseURL: string, data: Record<string, unknown>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.post("/api/workspace/ops.inquiry/records", { data: { data } });
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

async function fetchInquiryRecordsByQuery(baseURL: string, q: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.get("/api/workspace/ops.inquiry/records", {
        params: { q, limit: "200", filters: "{}", timeRange: "" },
      });
      const text = await res.text();
      let json: { records?: { id: number; data: Record<string, unknown> }[] } | null = null;
      try {
        json = JSON.parse(text) as { records?: { id: number; data: Record<string, unknown> }[] };
      } catch {
        // transient html error page from dev server
      }
      if (res.ok() && Array.isArray(json?.records)) return json.records;
      throw new Error(`fetch records failed: ${res.status()} ${text.slice(0, 300)}`);
    } catch (err) {
      lastError = err;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      await api.dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function deleteInquiryRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await api.delete(`/api/workspace/ops.inquiry/records/${id}`);
        if (res.ok() || res.status() === 404) return;
        const t = await res.text().catch(() => "");
        lastError = `delete record failed: ${res.status()} ${t}`;
      } catch (err) {
        lastError = String(err);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    // Fallback: transient API/compile errors should not block cleanup.
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

async function waitForWorkspaceRecord(id: number, options?: { timeoutMs?: number; expectedStatus?: string }) {
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const expectedStatus = options?.expectedStatus;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await fetchWorkspaceRecordById(id);
    if (row) {
      const status = String(row.data?.["状态"] ?? "");
      if (!expectedStatus || status === expectedStatus) return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`record not ready by id: ${id}, expectedStatus=${expectedStatus ?? "-"}`);
}

async function searchInquiryByNameWithRetry(page: import("@playwright/test").Page, name: string, rowLocator: import("@playwright/test").Locator) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByPlaceholder("商品名称").fill(name);
    const searchDone = page
      .waitForResponse(
        (r) => r.url().includes("/api/workspace/ops.inquiry/records") && r.request().method() === "GET",
        { timeout: 20_000 },
      )
      .catch(() => null);
    await page.getByRole("button", { name: "查询" }).click();
    await searchDone;
    const visible = await rowLocator.isVisible().catch(() => false);
    if (visible) return;
    if (attempt < 3) await page.waitForTimeout(1_000);
  }
}

async function gotoInquiryPage(page: import("@playwright/test").Page) {
  await page.goto("/work/ops/inquiry");
  await expect(page.getByPlaceholder("商品名称")).toBeVisible({ timeout: 120_000 });
}

async function loginAndSaveState(baseURL: string, username: string, password: string, out: string) {
  const api = await request.newContext({ baseURL });
  try {
    const csrfRes = await api.get("/api/auth/csrf");
    const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
    const csrfToken = typeof csrfJson.csrfToken === "string" ? csrfJson.csrfToken : "";
    if (!csrfRes.ok() || !csrfToken) throw new Error(`load csrf failed: ${csrfRes.status()}`);

    const signInRes = await api.post("/api/auth/callback/credentials?json=true", {
      form: {
        csrfToken,
        username,
        password,
        callbackUrl: "/work",
        json: "true",
      },
    });
    if (!signInRes.ok()) {
      const text = await signInRes.text().catch(() => "");
      throw new Error(`sign in failed: ${signInRes.status()} ${text}`);
    }

    const sessionRes = await api.get("/api/auth/session");
    const sessionJson = (await sessionRes.json().catch(() => null)) as null | { user?: { username?: string } };
    if (!sessionRes.ok() || String(sessionJson?.user?.username ?? "") !== username) {
      throw new Error(`session verify failed for ${username}`);
    }

    await api.storageState({ path: out });
  } finally {
    await api.dispose();
  }
}

async function ensureInquiryPermissionUsers(baseURL: string) {
  loadEnvLocal(process.cwd());
  const inquiryOtherUsername = process.env.E2E_INQUIRY_OTHER_USERNAME || "e2e_inquiry_other";
  const inquiryOtherPassword = process.env.E2E_INQUIRY_OTHER_PASSWORD || "StrongPass123";
  const inquiryAdminUsername = process.env.E2E_INQUIRY_ADMIN_USERNAME || "e2e_inquiry_admin";
  const inquiryAdminPassword = process.env.E2E_INQUIRY_ADMIN_PASSWORD || "StrongPass123";
  const inquiryMenuKeys = JSON.stringify(["ops.inquiry"]);
  const authDir = path.join(process.cwd(), "e2e", ".auth");
  const inquiryAdminState = path.join(authDir, "inquiry-admin.json");

  const dbHost = process.env.DB_HOST || "127.0.0.1";
  const dbPort = Number(process.env.DB_PORT || "3306");
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "";
  const dbDatabase = process.env.DB_DATABASE || "";
  if (!dbDatabase) throw new Error("DB_DATABASE missing");

  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
    multipleStatements: false,
  });
  try {
    const [inqRoleRows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", ["询价员"]);
    const inqRoleList = Array.isArray(inqRoleRows) ? (inqRoleRows as Array<{ id?: unknown }>) : [];
    let inqRoleId = inqRoleList.length > 0 && Number.isFinite(Number(inqRoleList[0]?.id)) ? Number(inqRoleList[0]?.id) : null;
    if (!inqRoleId) {
      const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
        "询价员",
        "E2E",
        inquiryMenuKeys,
      ]);
      inqRoleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
    } else {
      await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [inquiryMenuKeys, inqRoleId]);
    }

    const inquiryOtherHash = await bcrypt.hash(inquiryOtherPassword, 12);
    const [inqOtherUpdateRes] = await conn.query(
      "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'user', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
      ["E2E询价员-其他", inquiryOtherHash, inqRoleId, inquiryOtherUsername],
    );
    const inqOtherAffected = Number((inqOtherUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
    if (inqOtherAffected <= 0) {
      await conn.query(
        "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'user', ?)",
        [inquiryOtherUsername, "E2E询价员-其他", inquiryOtherHash, inqRoleId],
      );
    }

    const [inqAdminRoleRows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", ["询价管理员"]);
    const inqAdminRoleList = Array.isArray(inqAdminRoleRows) ? (inqAdminRoleRows as Array<{ id?: unknown }>) : [];
    let inqAdminRoleId =
      inqAdminRoleList.length > 0 && Number.isFinite(Number(inqAdminRoleList[0]?.id))
        ? Number(inqAdminRoleList[0]?.id)
        : null;
    if (!inqAdminRoleId) {
      const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
        "询价管理员",
        "E2E",
        inquiryMenuKeys,
      ]);
      inqAdminRoleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
    } else {
      await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [
        inquiryMenuKeys,
        inqAdminRoleId,
      ]);
    }

    const inquiryAdminHash = await bcrypt.hash(inquiryAdminPassword, 12);
    const [inqAdminUpdateRes] = await conn.query(
      "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'admin', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
      ["E2E询价管理员", inquiryAdminHash, inqAdminRoleId, inquiryAdminUsername],
    );
    const inqAdminAffected = Number((inqAdminUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
    if (inqAdminAffected <= 0) {
      await conn.query(
        "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'admin', ?)",
        [inquiryAdminUsername, "E2E询价管理员", inquiryAdminHash, inqAdminRoleId],
      );
    }
  } finally {
    await conn.end();
  }

  await loginAndSaveState(baseURL, inquiryAdminUsername, inquiryAdminPassword, inquiryAdminState);
  return { inquiryOtherUsername, inquiryAdminUsername, inquiryAdminState };
}

async function assignInquiryRecord(baseURL: string, storageState: string, recordId: number, assigneeUsername: string) {
  const api = await request.newContext({ baseURL, storageState });
  try {
    const res = await api.patch("/api/ops/inquiry/assign", {
      data: { recordIds: [recordId], assigneeUsername },
    });
    const json = (await res.json().catch(() => null)) as null | { error?: string; ok?: boolean };
    if (!res.ok()) throw new Error(`assign inquiry failed: ${res.status()} ${JSON.stringify(json)}`);
    return json;
  } finally {
    await api.dispose();
  }
}

async function patchInquiryRecord(
  baseURL: string,
  storageState: string,
  recordId: number,
  data: Record<string, unknown>,
) {
  const api = await request.newContext({ baseURL, storageState });
  try {
    return await api.patch(`/api/workspace/ops.inquiry/records/${recordId}`, {
      data: { data },
    });
  } finally {
    await api.dispose();
  }
}

async function fetchWorkspaceRecordById(id: number) {
  loadEnvLocal(process.cwd());
  const dbHost = process.env.DB_HOST || "127.0.0.1";
  const dbPort = Number(process.env.DB_PORT || "3306");
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "";
  const dbDatabase = process.env.DB_DATABASE || "";
  if (!dbDatabase) throw new Error("DB_DATABASE missing");

  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
    multipleStatements: false,
  });
  try {
    const [rows] = await conn.query<
      (RowDataPacket & {
        id: number;
        workspace_key: string;
        data: Record<string, unknown> | null;
      })[]
    >("SELECT id, workspace_key, data FROM workspace_records WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]);
    return rows[0] ?? null;
  } finally {
    await conn.end();
  }
}

test.describe.serial("询价页（ops.inquiry）", () => {
  let category = "";
  let adminState = "";
  let inquiryState = "";
  let inquiryAdminState = "";
  let inquiryUsername = "";
  let inquiryOtherUsername = "";
  let inquiryAdminUsername = "";
  let assignId: number | null = null;
  let withdrawId: number | null = null;
  let bulkId1: number | null = null;
  let bulkId2: number | null = null;
  let lockedId: number | null = null;
  let numericTypeId: number | null = null;
  let deniedEditId: number | null = null;
  let allowedEditId: number | null = null;
  let selfAssignId: number | null = null;
  let assignName = "";
  let withdrawName = "";
  let lockedName = "";
  let numericTypeName = "";
  let deniedEditName = "";
  let allowedEditName = "";
  let selfAssignName = "";
  let assignKey = "";
  let withdrawKey = "";
  let bulkKey1 = "";
  let bulkKey2 = "";
  let lockedKey = "";
  let deniedEditKey = "";
  let allowedEditKey = "";
  let selfAssignKey = "";
  let bulkName = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);
    inquiryUsername = process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry";

    const authDir = path.join(process.cwd(), "e2e", ".auth");
    adminState = path.join(authDir, "storage.json");
    inquiryState = path.join(authDir, "inquiry.json");
    await Promise.all([fs.access(adminState), fs.access(inquiryState)]);
    ({ inquiryOtherUsername, inquiryAdminUsername, inquiryAdminState } = await ensureInquiryPermissionUsers(baseURL));

    assignKey = unique("pw-inquiry-assign");
    withdrawKey = unique("pw-inquiry-withdraw");
    bulkKey1 = unique("pw-inquiry-bulk-1");
    bulkKey2 = unique("pw-inquiry-bulk-2");
    lockedKey = unique("pw-inquiry-locked");
    deniedEditKey = unique("pw-inquiry-denied");
    allowedEditKey = unique("pw-inquiry-allowed");
    selfAssignKey = unique("pw-inquiry-self-assign");
    bulkName = unique("E2E询价-批量修改");

    assignName = unique("E2E询价-待分配");
    assignId = await createInquiryRecord(baseURL, {
      名称: assignName,
      所属类目: category,
      产品规则: assignKey,
      状态: "待分配【询价】",
      "产品尺寸-长（厘米）": "10",
      "产品尺寸-宽（厘米）": "11",
      "产品尺寸-高（厘米）": "12",
      产品重量: "1",
      "单套尺寸-长（厘米）": "20",
      "单套尺寸-宽（厘米）": "21",
      "单套尺寸-高（厘米）": "22",
      "包裹实重（公斤）": "2",
    });

    withdrawName = unique("E2E询价-可撤回");
    withdrawId = await createInquiryRecord(baseURL, {
      名称: withdrawName,
      所属类目: category,
      产品规则: withdrawKey,
      状态: "待询价",
    });

    bulkId1 = await createInquiryRecord(baseURL, {
      名称: bulkName,
      所属类目: category,
      产品规则: bulkKey1,
      状态: "待询价",
    });

    bulkId2 = await createInquiryRecord(baseURL, {
      名称: bulkName,
      所属类目: category,
      产品规则: bulkKey2,
      状态: "待询价",
    });

    lockedName = unique("E2E询价-禁用撤回");
    lockedId = await createInquiryRecord(baseURL, {
      名称: lockedName,
      所属类目: category,
      产品规则: lockedKey,
      状态: "待分配【询价】",
    });

    numericTypeName = unique("E2E询价-数字类型测试");
    numericTypeId = await createInquiryRecord(baseURL, {
      名称: numericTypeName,
      所属类目: category,
      产品规则: unique("pw-inquiry-numeric"),
      状态: "待询价",
    });

    deniedEditName = unique("E2E询价-权限拒绝");
    deniedEditId = await createInquiryRecord(baseURL, {
      名称: deniedEditName,
      所属类目: category,
      产品规则: deniedEditKey,
      状态: "待分配【询价】",
    });

    allowedEditName = unique("E2E询价-分配后可编辑");
    allowedEditId = await createInquiryRecord(baseURL, {
      名称: allowedEditName,
      所属类目: category,
      产品规则: allowedEditKey,
      状态: "待分配【询价】",
    });

    selfAssignName = unique("E2E询价-自分配");
    selfAssignId = await createInquiryRecord(baseURL, {
      名称: selfAssignName,
      所属类目: category,
      产品规则: selfAssignKey,
      状态: "待分配【询价】",
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const ids = [assignId, withdrawId, bulkId1, bulkId2, lockedId, numericTypeId, deniedEditId, allowedEditId, selfAssignId]
      .filter((v): v is number => typeof v === "number");
    for (const id of ids) await deleteInquiryRecord(baseURL, id);
  });

  test("字段展示：表头/筛选控件/产品包裹格式", async ({ page }) => {
    await gotoInquiryPage(page);

    await expect(page.getByRole("columnheader", { name: "商品信息" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "参考链接" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "所属类目" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "产品属性" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "单套属性" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "操作" })).toBeVisible();

    await expect(page.getByLabel("全选")).toBeVisible();
    await expect(page.getByPlaceholder("商品名称")).toBeVisible();
    await expect(page.getByText("所属类目").locator("..").locator("select")).toBeVisible();
    await expect(page.getByText("时间范围").locator("..").locator("select")).toBeVisible();

    if (assignName) {
      const row = page.locator("tbody tr").first();
      await searchInquiryByNameWithRetry(page, assignName, row);
      await expect(row).toContainText("10x11x12cm", { timeout: 30_000 });
      await expect(row).toContainText("1kg");
      await expect(row).toContainText("20x21x22cm");
      await expect(row).toContainText("2kg");
      await expect(row).toContainText("待分配【询价】");
    }
  });

  test("撤回按钮禁用：仅待询价可撤回", async ({ page }) => {
    if (!lockedId) throw new Error("lockedId missing");
    await gotoInquiryPage(page);
    const row = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${lockedId}`) }).first();
    await searchInquiryByNameWithRetry(page, lockedName, row);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole("button", { name: "撤回" })).toBeDisabled();
  });

  test("批量分配询价人：UI操作 + 落库断言", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!assignId) throw new Error("assignId missing");
    const inquiryUsername = process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry";

    await gotoInquiryPage(page);
    const targetRow = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${assignId}`) }).first();
    await searchInquiryByNameWithRetry(page, assignName, targetRow);

    await page.getByLabel(`选择 ID ${assignId}`).check();
    await expect(page.getByRole("button", { name: "批量分配" })).toBeEnabled();

    // GET /api/ops/inquiry/assign fires when the modal opens (to populate assignee dropdown).
    // PATCH fires on 确认分配. Both are first-time calls to this route → need long timeouts.
    const assigneesLoaded = page.waitForResponse(
      (r) => r.url().includes("/api/ops/inquiry/assign") && r.request().method() === "GET",
      { timeout: 120_000 },
    );
    await page.getByRole("button", { name: "批量分配" }).click();

    const modal = page.locator('[data-edit-modal="inquiry-bulk-assign"]');
    await expect(modal).toBeVisible();
    await assigneesLoaded; // wait for dropdown options to be populated

    const assignPatch = page.waitForResponse(
      (r) => r.url().includes("/api/ops/inquiry/assign") && r.request().method() === "PATCH",
      { timeout: 120_000 },
    );
    await modal.getByText("选择询价人", { exact: true }).locator("..").locator("select").selectOption({ label: "E2E询价员" });
    await modal.getByRole("button", { name: "确认分配" }).click();
    await assignPatch;
    await expect(modal).toBeHidden();

    const records = await fetchInquiryRecordsByQuery(baseURL, assignKey);
    const row = records.find((r) => r.id === assignId) ?? null;
    expect(row).toBeTruthy();
    expect(String(row?.data?.["状态"] ?? "")).toBe("待询价");
    expect(String(row?.data?.["询价人"] ?? "")).toBe(inquiryUsername);
  });

  test("批量修改并提交：UI操作 + 落库断言", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!bulkId1 || !bulkId2) throw new Error("bulk ids missing");

    await gotoInquiryPage(page);
    const bulkRow = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${bulkId1}`) }).first();
    await searchInquiryByNameWithRetry(page, bulkName, bulkRow);

    await page.getByLabel(`选择 ID ${bulkId1}`).check();
    await page.getByLabel(`选择 ID ${bulkId2}`).check();

    const openBtn = page.getByRole("button", { name: /批量修改数据/ });
    await expect(openBtn).toBeEnabled();
    await openBtn.click();

    const modal = page.locator('[data-edit-modal="inquiry-bulk-edit"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByText(bulkName).first()).toBeVisible();

    await modal.getByText("产品单价", { exact: true }).locator("..").locator("input").fill("9.9");
    await modal.getByText("起订量", { exact: true }).locator("..").locator("input").fill("100");
    await modal.getByText(/单套尺寸（长 \/ 宽 \/ 高/).locator("..").locator("input").nth(0).fill("33");
    await modal.getByText(/单套尺寸（长 \/ 宽 \/ 高/).locator("..").locator("input").nth(1).fill("34");
    await modal.getByText(/单套尺寸（长 \/ 宽 \/ 高/).locator("..").locator("input").nth(2).fill("35");
    await modal.getByText(/包裹重量/).first().locator("..").locator("input").fill("3.3");

    const firstPatch = page
      .waitForResponse(
      (r) => /\/api\/workspace\/ops\.inquiry\/records\/\d+/.test(r.url()) && r.request().method() === "PATCH",
      { timeout: 120_000 },
      )
      .catch(() => null);
    const reloadAfterSubmit = page
      .waitForResponse(
        (r) => r.url().includes("/api/workspace/ops.inquiry/records") && r.request().method() === "GET",
        { timeout: 120_000 },
      )
      .catch(() => null);
    await modal.getByRole("button", { name: "提交" }).click();
    await firstPatch;
    await expect(modal).toBeHidden({ timeout: 60_000 });
    await reloadAfterSubmit;

    const selected = await Promise.all([
      waitForWorkspaceRecord(bulkId1, { expectedStatus: "待分配运营者" }),
      waitForWorkspaceRecord(bulkId2, { expectedStatus: "待分配运营者" }),
    ]);
    for (const r of selected) {
      expect(String(r.data?.["产品单价"] ?? "")).toBe("9.9");
      expect(String(r.data?.["起订量"] ?? "")).toBe("100");
      expect(String(r.data?.["单套尺寸-长（厘米）"] ?? "")).toBe("33");
      expect(String(r.data?.["单套尺寸-宽（厘米）"] ?? "")).toBe("34");
      expect(String(r.data?.["单套尺寸-高（厘米）"] ?? "")).toBe("35");
      expect(String(r.data?.["包裹实重（公斤）"] ?? "")).toBe("3.3");
      expect(String(r.data?.["状态"] ?? "")).toBe("待分配运营者");
    }
  });

  test("撤回：理由必填 + 状态回到待选品 + 落库断言", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!withdrawId) throw new Error("withdrawId missing");
    const reason = unique("E2E撤回理由");

    await gotoInquiryPage(page);

    const row = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${withdrawId}`) }).first();
    await searchInquiryByNameWithRetry(page, withdrawName, row);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "撤回" }).click();

    const modal = page.locator('[data-edit-modal="inquiry-withdraw"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "确定撤回" })).toBeDisabled();
    await modal.locator("textarea").fill(reason);
    await expect(modal.getByRole("button", { name: "确定撤回" })).toBeEnabled();
    const withdrawPatch = page.waitForResponse(
      (r) => /\/api\/workspace\/ops\.inquiry\/records\/\d+\/withdraw/.test(r.url()) && r.request().method() === "PATCH",
      { timeout: 120_000 },
    );
    const reloadAfterWithdraw = page.waitForResponse(
      (r) => r.url().includes("/api/workspace/ops.inquiry/records") && r.request().method() === "GET",
      { timeout: 120_000 },
    );
    await modal.getByRole("button", { name: "确定撤回" }).click();
    await withdrawPatch;
    await expect(modal).toBeHidden({ timeout: 60_000 });
    await reloadAfterWithdraw;

    const records = await fetchInquiryRecordsByQuery(baseURL, withdrawKey);
    const rowAfter = records.find((r) => r.id === withdrawId) ?? null;
    expect(rowAfter).toBeTruthy();
    expect(String(rowAfter?.data?.["状态"] ?? "")).toBe("待选品");
    expect(String(rowAfter?.data?.["撤回理由"] ?? "")).toBe(reason);
  });

  test("批量修改弹窗：产品单价和起订量为数字输入框", async ({ page }) => {
    if (!numericTypeId) throw new Error("numericTypeId missing");

    await gotoInquiryPage(page);
    const row = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${numericTypeId}`) }).first();
    await searchInquiryByNameWithRetry(page, numericTypeName, row);

    await page.getByLabel(`选择 ID ${numericTypeId}`).check();
    await page.getByRole("button", { name: /批量修改数据/ }).click();

    const modal = page.locator('[data-edit-modal="inquiry-bulk-edit"]');
    await expect(modal).toBeVisible();

    const unitPriceInput = modal
      .getByText("产品单价", { exact: true })
      .locator("..")
      .locator("input");
    await expect(unitPriceInput).toHaveAttribute("type", "number");

    const moqInput = modal
      .getByText("起订量", { exact: true })
      .locator("..")
      .locator("input");
    await expect(moqInput).toHaveAttribute("type", "number");

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  test("权限控制：普通询价员修改已分配给其他询价员的记录应被拒绝", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!deniedEditId) throw new Error("deniedEditId missing");
    const recordId = deniedEditId;

    await assignInquiryRecord(baseURL, adminState, recordId, inquiryOtherUsername);

    const recordsAfterAssign = await fetchInquiryRecordsByQuery(baseURL, deniedEditKey);
    const assignedRow = recordsAfterAssign.find((r) => r.id === recordId) ?? null;
    expect(assignedRow).toBeTruthy();
    expect(String(assignedRow?.data?.["询价人"] ?? "")).toBe(inquiryOtherUsername);
    expect(String(assignedRow?.data?.["状态"] ?? "")).toBe("待询价");

    const inquiryApi = await request.newContext({ baseURL, storageState: inquiryState });
    try {
      const patchResponse = await inquiryApi.patch(`/api/workspace/ops.inquiry/records/${recordId}`, {
        data: {
          data: {
            产品单价: "88.8",
          },
        },
      });
      const json = (await patchResponse.json().catch(() => null)) as null | { error?: string };
      expect(patchResponse.status()).toBe(403);
      expect(String(json?.error ?? "")).toContain("仅被分配的询价人可修改此记录");
    } finally {
      await inquiryApi.dispose();
    }

    const deniedRow = await fetchWorkspaceRecordById(recordId);
    expect(deniedRow).toBeTruthy();
    expect(deniedRow?.workspace_key).toBe("ops.selection");
    expect(String(deniedRow?.data?.["产品单价"] ?? "")).toBe("");
    expect(String(deniedRow?.data?.["状态"] ?? "")).toBe("待询价");
  });

  test("权限控制：管理员分配给询价员后，该询价员可以修改并提交", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!allowedEditId) throw new Error("allowedEditId missing");
    const recordId = allowedEditId;

    await assignInquiryRecord(baseURL, adminState, recordId, inquiryUsername);

    const patchResponse = await patchInquiryRecord(baseURL, inquiryState, recordId, {
      产品单价: "19.9",
      起订量: "120",
      状态: "待分配运营者",
    });
    expect(patchResponse.ok()).toBeTruthy();

    const row = await fetchWorkspaceRecordById(recordId);
    expect(row).toBeTruthy();
    expect(row?.workspace_key).toBe("ops.purchase");
    expect(String(row?.data?.["询价人"] ?? "")).toBe(inquiryUsername);
    expect(String(row?.data?.["产品单价"] ?? "")).toBe("19.9");
    expect(String(row?.data?.["起订量"] ?? "")).toBe("120");
    expect(String(row?.data?.["状态"] ?? "")).toBe("待分配运营者");
  });

  test("权限控制：管理员账号可先分配给自己，再修改成功", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!selfAssignId) throw new Error("selfAssignId missing");
    const recordId = selfAssignId;

    await assignInquiryRecord(baseURL, inquiryAdminState, recordId, inquiryAdminUsername);

    const patchResponse = await patchInquiryRecord(baseURL, inquiryAdminState, recordId, {
      产品单价: "29.9",
      起订量: "66",
      状态: "待分配运营者",
    });
    expect(patchResponse.ok()).toBeTruthy();

    const row = await fetchWorkspaceRecordById(recordId);
    expect(row).toBeTruthy();
    expect(row?.workspace_key).toBe("ops.purchase");
    expect(String(row?.data?.["询价人"] ?? "")).toBe(inquiryAdminUsername);
    expect(String(row?.data?.["产品单价"] ?? "")).toBe("29.9");
    expect(String(row?.data?.["起订量"] ?? "")).toBe("66");
    expect(String(row?.data?.["状态"] ?? "")).toBe("待分配运营者");
  });
});
