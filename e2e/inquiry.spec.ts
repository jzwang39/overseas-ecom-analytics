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

async function createInquiryRecord(baseURL: string, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post("/api/workspace/ops.inquiry/records", { data: { data } });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function fetchInquiryRecordsByQuery(baseURL: string, q: string) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get("/api/workspace/ops.inquiry/records", { params: { q, limit: "200", filters: "{}", timeRange: "" } });
    const json = (await res.json()) as { records: { id: number; data: Record<string, unknown> }[] };
    if (!res.ok()) throw new Error(`fetch records failed: ${res.status()} ${JSON.stringify(json)}`);
    return json.records;
  } finally {
    await api.dispose();
  }
}

async function deleteInquiryRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.delete(`/api/workspace/ops.inquiry/records/${id}`);
    if (!res.ok() && res.status() !== 404) {
      const t = await res.text().catch(() => "");
      throw new Error(`delete record failed: ${res.status()} ${t}`);
    }
  } finally {
    await api.dispose();
  }
}

test.describe.serial("询价页（ops.inquiry）", () => {
  let category = "";
  let assignId: number | null = null;
  let withdrawId: number | null = null;
  let bulkId1: number | null = null;
  let bulkId2: number | null = null;
  let lockedId: number | null = null;
  let assignName = "";
  let withdrawName = "";
  let lockedName = "";
  let assignKey = "";
  let withdrawKey = "";
  let bulkKey1 = "";
  let bulkKey2 = "";
  let lockedKey = "";
  let bulkName = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);

    assignKey = unique("pw-inquiry-assign");
    withdrawKey = unique("pw-inquiry-withdraw");
    bulkKey1 = unique("pw-inquiry-bulk-1");
    bulkKey2 = unique("pw-inquiry-bulk-2");
    lockedKey = unique("pw-inquiry-locked");
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
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const ids = [assignId, withdrawId, bulkId1, bulkId2, lockedId].filter((v): v is number => typeof v === "number");
    for (const id of ids) await deleteInquiryRecord(baseURL, id);
  });

  test("字段展示：表头/筛选控件/产品包裹格式", async ({ page }) => {
    await page.goto("/work/ops/inquiry");

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
      await page.getByPlaceholder("商品名称").fill(assignName);
      await page.getByRole("button", { name: "查询" }).click();
      const row = page.locator("tbody tr").first();
      await expect(row).toContainText("10x11x12cm");
      await expect(row).toContainText("1kg");
      await expect(row).toContainText("20x21x22cm");
      await expect(row).toContainText("2kg");
      await expect(row).toContainText("待分配【询价】");
    }
  });

  test("撤回按钮禁用：仅待询价可撤回", async ({ page }) => {
    if (!lockedId) throw new Error("lockedId missing");
    await page.goto("/work/ops/inquiry");
    await page.getByPlaceholder("商品名称").fill(lockedName);
    await page.getByRole("button", { name: "查询" }).click();
    const row = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${lockedId}`) }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "撤回" })).toBeDisabled();
  });

  test("批量分配询价人：UI操作 + 落库断言", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!assignId) throw new Error("assignId missing");
    const inquiryUsername = process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry";

    await page.goto("/work/ops/inquiry");
    await page.getByPlaceholder("商品名称").fill(assignName);
    await page.getByRole("button", { name: "查询" }).click();

    await page.getByLabel(`选择 ID ${assignId}`).check();
    await expect(page.getByRole("button", { name: "批量分配" })).toBeEnabled();
    await page.getByRole("button", { name: "批量分配" }).click();

    const modal = page.locator('[data-edit-modal="inquiry-bulk-assign"]');
    await expect(modal).toBeVisible();
    await modal.getByText("选择询价人", { exact: true }).locator("..").locator("select").selectOption({ label: "E2E询价员" });
    await modal.getByRole("button", { name: "确认分配" }).click();
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

    await page.goto("/work/ops/inquiry");
    await page.getByPlaceholder("商品名称").fill(bulkName);
    await page.getByRole("button", { name: "查询" }).click();

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

    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();

    const records = await fetchInquiryRecordsByQuery(baseURL, bulkName);
    const ids = new Set([bulkId1, bulkId2]);
    const selected = records.filter((r) => ids.has(r.id));
    expect(selected).toHaveLength(2);
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

    await page.goto("/work/ops/inquiry");
    await page.getByPlaceholder("商品名称").fill(withdrawName);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { has: page.getByLabel(`选择 ID ${withdrawId}`) }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();

    const modal = page.locator('[data-edit-modal="inquiry-withdraw"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "确定撤回" })).toBeDisabled();
    await modal.locator("textarea").fill(reason);
    await expect(modal.getByRole("button", { name: "确定撤回" })).toBeEnabled();
    await modal.getByRole("button", { name: "确定撤回" }).click();
    await expect(modal).toBeHidden();

    const records = await fetchInquiryRecordsByQuery(baseURL, withdrawKey);
    const rowAfter = records.find((r) => r.id === withdrawId) ?? null;
    expect(rowAfter).toBeTruthy();
    expect(String(rowAfter?.data?.["状态"] ?? "")).toBe("待选品");
    expect(String(rowAfter?.data?.["撤回理由"] ?? "")).toBe(reason);
  });
});
