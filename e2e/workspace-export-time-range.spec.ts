import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import { loadEnvLocal } from "./utils/env";
import { newAuthedApi } from "./utils/api";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatYmd(value: Date) {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function atNoon(daysOffset: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + daysOffset);
  return value;
}

async function ensureCategory(baseURL: string, name: string) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post("/api/admin/categories", { data: { name } });
    if (!res.ok() && res.status() !== 409) {
      throw new Error(`create category failed: ${res.status()}`);
    }
    return name;
  } finally {
    await api.dispose();
  }
}

async function createSelectionRecord(data: Record<string, unknown>) {
  return withDb(async (conn) => {
    const [result] = await conn.query<mysql.ResultSetHeader>(
      "INSERT INTO workspace_records(workspace_key, data, abandon_reason) VALUES ('ops.selection', CAST(? AS JSON), NULL)",
      [JSON.stringify(data)],
    );
    return Number(result.insertId);
  });
}

async function createInquiryRecord(baseURL: string, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post("/api/workspace/ops.inquiry/records", { data: { data } });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) {
      throw new Error(`create inquiry record failed: ${res.status()} ${JSON.stringify(json)}`);
    }
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function deleteSelectionRecord(id: number | null) {
  if (id == null) return;
  await withDb(async (conn) => {
    await conn.query("UPDATE workspace_records SET deleted_at = NOW() WHERE id = ?", [id]);
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

async function setRecordUpdatedAt(id: number, updatedAt: Date) {
  await withDb(async (conn) => {
    await conn.query("UPDATE workspace_records SET updated_at = ? WHERE id = ?", [updatedAt, id]);
  });
}

async function exportRows(
  baseURL: string,
  params: Record<string, string>,
) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get("/api/workspace/ops.selection/export", { params });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers()["content-disposition"]).toContain("ops.selection.xlsx");

    const body = await res.body();
    const workbook = XLSX.read(body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } finally {
    await api.dispose();
  }
}

async function fetchInquiryRows(baseURL: string, params: Record<string, string>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.get("/api/workspace/ops.inquiry/records", { params });
      if (!res.ok()) {
        const body = await res.text().catch(() => "");
        throw new Error(`fetch inquiry rows failed: ${res.status()} ${body}`);
      }
      return (await res.json()) as { records?: Array<{ data?: Record<string, unknown> }> };
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    } finally {
      await api.dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

test.describe.serial("工作台导出与时间范围", () => {
  let exportCategory = "";
  let otherCategory = "";

  let exportRecentId: number | null = null;
  let exportOldId: number | null = null;
  let exportNoiseId: number | null = null;
  let timeRecentId: number | null = null;
  let timeOldId: number | null = null;

  let exportRecentName = "";
  let exportOldName = "";
  let exportNoiseName = "";
  let timeRecentName = "";
  let timeOldName = "";

  const exportPrefix = unique("E2E导出");
  const timePrefix = unique("E2E时间范围");

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    exportCategory = await ensureCategory(baseURL, unique("E2E类目导出"));
    otherCategory = await ensureCategory(baseURL, unique("E2E类目导出-其他"));

    exportRecentName = `${exportPrefix}-最近`;
    exportOldName = `${exportPrefix}-过期`;
    exportNoiseName = `${exportPrefix}-噪音`;
    timeRecentName = `${timePrefix}-最近`;
    timeOldName = `${timePrefix}-过期`;

    exportRecentId = await createSelectionRecord({
      名称: exportRecentName,
      所属类目: exportCategory,
      产品规则: unique("rule-export-recent"),
      状态: "待询价",
    });
    exportOldId = await createSelectionRecord({
      名称: exportOldName,
      所属类目: exportCategory,
      产品规则: unique("rule-export-old"),
      状态: "待询价",
    });
    exportNoiseId = await createSelectionRecord({
      名称: exportNoiseName,
      所属类目: otherCategory,
      产品规则: unique("rule-export-noise"),
      状态: "待询价",
    });
    timeRecentId = await createInquiryRecord(baseURL, {
      名称: timeRecentName,
      所属类目: exportCategory,
      产品规则: unique("rule-time-recent"),
      状态: "待询价",
    });
    timeOldId = await createInquiryRecord(baseURL, {
      名称: timeOldName,
      所属类目: exportCategory,
      产品规则: unique("rule-time-old"),
      状态: "待询价",
    });

    await setRecordUpdatedAt(exportRecentId, atNoon(-2));
    await setRecordUpdatedAt(exportOldId, atNoon(-45));
    await setRecordUpdatedAt(exportNoiseId, atNoon(-2));
    await setRecordUpdatedAt(timeRecentId, atNoon(-1));
    await setRecordUpdatedAt(timeOldId, atNoon(-20));
  });

  test.afterAll(async () => {
    await deleteSelectionRecord(exportRecentId);
    await deleteSelectionRecord(exportOldId);
    await deleteSelectionRecord(exportNoiseId);
    await deleteSelectionRecord(timeRecentId);
    await deleteSelectionRecord(timeOldId);
  });

  test("P1：导出 Excel 会同时应用名称筛选、字段筛选和时间范围", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const rows = await exportRows(baseURL, {
      filters: JSON.stringify({ 名称: exportPrefix, 所属类目: exportCategory }),
      timeRange: "30d",
    });

    const names = rows.map((row) => String(row["名称"] ?? ""));
    expect(names).toContain(exportRecentName);
    expect(names).not.toContain(exportOldName);
    expect(names).not.toContain(exportNoiseName);
  });

  test("P1：询价工作台时间范围筛选会校验日期，且接口按范围过滤结果", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    test.setTimeout(120_000);

    const timeRangeSelect = page.getByRole("combobox").nth(1);
    const queryButton = page.getByRole("button", { name: /查询/ });
    const validStart = formatYmd(atNoon(-3));
    const validEnd = formatYmd(atNoon(0));

    await page.goto("/work/ops/inquiry");
    await expect(page.getByPlaceholder("商品名称")).toBeVisible({ timeout: 60_000 });
    await expect(queryButton).toBeEnabled({ timeout: 60_000 });

    const presetJson = await fetchInquiryRows(baseURL, {
      filters: JSON.stringify({ 名称: timePrefix }),
      timeRange: "7d",
      limit: "50",
    });
    const presetNames = (presetJson.records ?? []).map((row) => String(row.data?.["名称"] ?? ""));
    expect(presetNames).toContain(timeRecentName);
    expect(presetNames).not.toContain(timeOldName);

    const customJson = await fetchInquiryRows(baseURL, {
      filters: JSON.stringify({ 名称: timePrefix }),
      timeRange: "custom",
      startDate: validStart,
      endDate: validEnd,
      limit: "50",
    });
    const customNames = (customJson.records ?? []).map((row) => String(row.data?.["名称"] ?? ""));
    expect(customNames).toContain(timeRecentName);
    expect(customNames).not.toContain(timeOldName);

    await page.getByPlaceholder("商品名称").fill(timePrefix);
    await expect(queryButton).toBeEnabled({ timeout: 60_000 });

    await timeRangeSelect.selectOption("7d");
    await expect(timeRangeSelect).toHaveValue("7d");

    await timeRangeSelect.selectOption("custom");
    const startInput = page.getByText("开始日期").locator("..").locator('input[type="date"]');
    const endInput = page.getByText("结束日期").locator("..").locator('input[type="date"]');

    await startInput.fill(validEnd);
    await endInput.fill(validStart);
    await expect(queryButton).toBeDisabled();

    await startInput.fill(validStart);
    await endInput.fill(validEnd);
    await expect(queryButton).toBeEnabled();
  });
});
