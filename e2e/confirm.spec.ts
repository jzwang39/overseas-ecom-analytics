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

async function createConfirmRecord(baseURL: string, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.post("/api/workspace/ops.confirm/records", { data: { data } });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) throw new Error(`create record failed: ${res.status()} ${JSON.stringify(json)}`);
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function fetchConfirmRecordsByQuery(baseURL: string, q: string) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get("/api/workspace/ops.confirm/records", {
      params: { q, limit: "200", filters: "{}", timeRange: "" },
    });
    const json = (await res.json()) as { records: { id: number; data: Record<string, unknown> }[] };
    if (!res.ok()) throw new Error(`fetch records failed: ${res.status()} ${JSON.stringify(json)}`);
    return json.records;
  } finally {
    await api.dispose();
  }
}

async function fetchConfirmRecordById(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.get(`/api/workspace/ops.confirm/records/${id}`);
    const json = (await res.json().catch(() => null)) as null | { record?: { id: number; data: Record<string, unknown> } };
    if (!res.ok() || !json?.record) throw new Error(`fetch record failed: ${res.status()} ${JSON.stringify(json)}`);
    return json.record;
  } finally {
    await api.dispose();
  }
}

async function patchConfirmRecord(baseURL: string, id: number, data: Record<string, unknown>) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.patch(`/api/workspace/ops.confirm/records/${id}`, { data: { data } });
    if (!res.ok()) {
      const t = await res.text().catch(() => "");
      throw new Error(`patch record failed: ${res.status()} ${t}`);
    }
  } finally {
    await api.dispose();
  }
}

async function deleteConfirmRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.delete(`/api/workspace/ops.confirm/records/${id}`);
    if (!res.ok() && res.status() !== 404) {
      const t = await res.text().catch(() => "");
      throw new Error(`delete record failed: ${res.status()} ${t}`);
    }
  } finally {
    await api.dispose();
  }
}

test.describe.serial("确品页（ops.confirm）", () => {
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

    saveId = await createConfirmRecord(baseURL, {
      名称: saveName,
      所属类目: category,
      产品规则: saveRule,
      状态: "待确品",
      公司编码: "",
    });

    submitId = await createConfirmRecord(baseURL, {
      名称: submitName,
      所属类目: category,
      产品规则: submitRule,
      状态: "待确品",
      仓库编码: "",
    });

    withdrawId = await createConfirmRecord(baseURL, {
      名称: withdrawName,
      所属类目: category,
      产品规则: withdrawRule,
      状态: "待确品",
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL) return;
    const ids = [displayId, saveId, submitId, withdrawId].filter((v): v is number => typeof v === "number");
    for (const id of ids) await deleteConfirmRecord(baseURL, id);
  });

  test("字段展示：表头/筛选控件/产品与包裹格式", async ({ page }) => {
    await page.goto("/work/ops/confirm");

    await expect(page.getByRole("button", { name: /全部待确品商品/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^待确品/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^待采购/ })).toBeVisible();

    await expect(page.getByPlaceholder(/商品名称/)).toBeVisible();
    await expect(page.getByText("所属类目").locator("..").locator("select")).toBeVisible();
    await expect(page.getByText("时间范围").locator("..").locator("select")).toBeVisible();
    await expect(page.getByRole("button", { name: "查询" })).toBeVisible();

    await expect(page.getByRole("columnheader", { name: "商品基本信息" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "产品属性" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "单套属性" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "状态" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "操作" })).toBeVisible();

    await page.getByPlaceholder(/商品名称/).fill(displayName);
    await page.getByRole("button", { name: "查询" }).click();
    const row = page.locator("tbody tr", { hasText: displayName }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("10x11x12 cm");
    await expect(row).toContainText("1 kg");
    await expect(row).toContainText("20x21x22 cm");
    await expect(row).toContainText("2 kg");
    await expect(row).toContainText("待确品");
  });

  test("修改并保存：字段写入 + 状态不变（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!saveId) throw new Error("saveId missing");
    const minPrice = "11.1";
    const maxPrice = "22.2";

    await page.goto("/work/ops/confirm");
    await page.getByPlaceholder(/商品名称/).fill(saveName);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { hasText: saveName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();

    const modal = page.locator('[data-edit-modal="default"]');
    await expect(modal).toBeVisible();
    const priceRow = modal.getByText("平台在售价格区间", { exact: true }).locator("..");
    await priceRow.getByRole("spinbutton").nth(0).fill(minPrice);
    await priceRow.getByRole("spinbutton").nth(1).fill(maxPrice);
    await modal.getByRole("button", { name: "保存" }).click();
    await expect(modal).toBeHidden();

    const records = await fetchConfirmRecordsByQuery(baseURL, saveName);
    const r = records.find((x) => x.id === saveId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["平台在售价格（Min）"] ?? "")).toBe(minPrice);
    expect(String(r?.data?.["平台在售价格（Max）"] ?? "")).toBe(maxPrice);
    expect(String(r?.data?.["状态"] ?? "")).toBe("待确品");
    expect(String(r?.data?.["最后更新时间"] ?? "")).not.toBe("");
  });

  test("提交：待确品 -> 待采购（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!submitId) throw new Error("submitId missing");
    const minPrice = "33.3";

    await page.goto("/work/ops/confirm");
    await page.getByPlaceholder(/商品名称/).fill(submitName);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { hasText: submitName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "修改" }).click();

    const modal = page.locator('[data-edit-modal="default"]');
    await expect(modal).toBeVisible();
    const priceRow = modal.getByText("平台在售价格区间", { exact: true }).locator("..");
    await priceRow.getByRole("spinbutton").nth(0).fill(minPrice);
    await modal.getByRole("button", { name: "提交" }).click();
    await expect(modal).toBeHidden();

    const records = await fetchConfirmRecordsByQuery(baseURL, submitName);
    const r = records.find((x) => x.id === submitId) ?? null;
    expect(r).toBeTruthy();
    expect(String(r?.data?.["平台在售价格（Min）"] ?? "")).toBe(minPrice);
    expect(String(r?.data?.["状态"] ?? "")).toBe("待采购");

    const state = await page.context().storageState();
    const fresh = await page.context().browser()?.newContext({ storageState: state });
    if (!fresh) throw new Error("browser context missing");
    const p2 = await fresh.newPage({ baseURL });
    await p2.goto("/work/ops/confirm");
    await p2.getByPlaceholder(/商品名称/).fill(submitName);
    await p2.getByRole("button", { name: "查询" }).click();
    await expect(p2.locator("tbody")).toContainText("待采购");
    await fresh.close();
  });

  test("撤回：理由必填 + 状态->待核价 + 写入撤回理由（落库）", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!withdrawId) throw new Error("withdrawId missing");
    const reason = unique("E2E撤回理由");

    const pre = await fetchConfirmRecordById(baseURL, withdrawId);
    if (String(pre.data?.["状态"] ?? "") !== "待确品") {
      await patchConfirmRecord(baseURL, withdrawId, { ...pre.data, 状态: "待确品", 撤回理由: "" });
    }

    await page.goto("/work/ops/confirm");
    await page.getByPlaceholder(/商品名称/).fill(withdrawName);
    await page.getByRole("button", { name: "查询" }).click();

    const row = page.locator("tbody tr", { hasText: withdrawName }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤回" }).click();

    const modal = page.locator('[data-edit-modal="confirm-withdraw"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "确认撤回" })).toBeDisabled();
    await modal.locator("textarea").fill(reason);
    await expect(modal.getByRole("button", { name: "确认撤回" })).toBeEnabled();
    await modal.getByRole("button", { name: "确认撤回" }).click();
    await expect(modal).toBeHidden();

    const r = await fetchConfirmRecordById(baseURL, withdrawId);
    expect(String(r.data?.["状态"] ?? "")).toBe("待核价");
    expect(String(r.data?.["撤回理由"] ?? "")).toBe(reason);
  });
});
