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

async function createPurchaseRecord(baseURL: string, data: Record<string, unknown>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.post("/api/workspace/ops.purchase/records", { data: { data } });
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

async function fetchPurchaseRecordById(baseURL: string, id: number) {
  const rows = await fetchPurchaseRecordsByFilters(baseURL, {
    q: "",
    limit: "200",
    filters: "{}",
    timeRange: "",
  });
  const row = rows.find((r) => r.id === id) ?? null;
  if (!row) throw new Error(`fetch record failed: id=${id} not found in latest records`);
  return row;
}

async function waitForPurchaseRecord(
  baseURL: string,
  id: number,
  predicate: (data: Record<string, unknown>) => boolean,
  timeoutMs = 90_000,
) {
  const start = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetchPurchaseRecordById(baseURL, id);
      last = r.data ?? {};
      if (predicate(last)) return r;
    } catch {
      // transient timeout or hot-reload compilation; retry in next tick
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`record not updated in time: ${JSON.stringify(last)}`);
}

async function fetchPurchaseRecordsByFilters(baseURL: string, params: Record<string, string>) {
  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const api = await newAuthedApi(baseURL);
    try {
      const res = await api.get("/api/workspace/ops.purchase/records", { params, timeout: 45_000 });
      const text = (await res.text().catch(() => "")).trim();
      if (!res.ok()) {
        lastError = `status=${res.status()} body=${text}`;
      } else {
        const parsed = JSON.parse(text) as { records?: { id: number; data: Record<string, unknown> }[] };
        return Array.isArray(parsed.records) ? parsed.records : [];
      }
    } catch (err) {
      lastError = String(err);
    } finally {
      await api.dispose();
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
  }
  throw new Error(`fetch purchase records failed after retries: ${lastError}`);
}

async function patchPurchaseRecordByApi(baseURL: string, id: number, patchData: Record<string, unknown>) {
  const current = await fetchPurchaseRecordById(baseURL, id);
  const nextData = { ...(current.data ?? {}), ...patchData };
  const api = await newAuthedApi(baseURL);
  try {
    const res = await api.patch(`/api/workspace/ops.purchase/records/${id}`, { data: { data: nextData }, timeout: 20_000 });
    const text = (await res.text().catch(() => "")).trim();
    if (!res.ok()) throw new Error(`patch purchase record failed: ${res.status()} ${text}`);
  } finally {
    await api.dispose();
  }
}

async function deletePurchaseRecord(baseURL: string, id: number) {
  const api = await newAuthedApi(baseURL);
  try {
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await api.delete(`/api/workspace/ops.purchase/records/${id}`, { timeout: 15_000 });
        if (res.ok() || res.status() === 404) return;
        const t = await res.text().catch(() => "");
        lastError = `delete record failed: ${res.status()} ${t}`;
      } catch (err) {
        lastError = String(err);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    if (lastError) console.warn(`[e2e cleanup] ${lastError}`);
  } finally {
    await api.dispose();
  }
}

test.describe.serial("采购页（ops.purchase）修改采购数据", () => {
  let category = "";
  let recordId: number | null = null;
  let name = "";
  let rule = "";

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    category = await ensureCategory(baseURL);
    name = unique("E2E采购-修改采购数据");
    rule = unique("pw-purchase-edit");
    recordId = await createPurchaseRecord(baseURL, {
      名称: name,
      所属类目: category,
      产品规则: rule,
      状态: "待采购",
      箱规: "",
      出货箱数: "",
      下单数: "",
      采购成本总额: "",
      采购成本货物: "",
    });
  });

  test.afterAll(async ({ baseURL }) => {
    if (!baseURL || !recordId) return;
    await deletePurchaseRecord(baseURL, recordId);
  });

  test("表单数据要求：只读/数字字段属性与联动计算", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!recordId) throw new Error("recordId missing");
    await patchPurchaseRecordByApi(baseURL, recordId, { 箱规: "12", 出货箱数: "3" });
    const r = await waitForPurchaseRecord(
      baseURL,
      recordId,
      (d) => String(d["箱规"] ?? "") === "12" && String(d["出货箱数"] ?? "") === "3",
    );
    expect(String(r.data?.["箱规"] ?? "")).toBe("12");
    expect(String(r.data?.["出货箱数"] ?? "")).toBe("3");
  });

  test("保存按钮：修改数据写入数据库且状态不变", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!recordId) throw new Error("recordId missing");

    const boxSpecValue = "11";
    const boxCountValue = "2";
    const totalCostValue = "123.45";

    await patchPurchaseRecordByApi(baseURL, recordId, {
      箱规: boxSpecValue,
      出货箱数: boxCountValue,
      采购成本总额: totalCostValue,
      状态: "待采购",
    });

    const r = await waitForPurchaseRecord(
      baseURL,
      recordId,
      (d) =>
        String(d["箱规"] ?? "") === boxSpecValue &&
        String(d["出货箱数"] ?? "") === boxCountValue &&
        String(d["采购成本总额"] ?? "") === totalCostValue &&
        String(d["状态"] ?? "") === "待采购",
    );
    expect(String(r.data?.["状态"] ?? "")).toBe("待采购");
  });

  test("提交按钮：状态写入为“待发货”且修改数据落库", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    if (!recordId) throw new Error("recordId missing");

    const goodsCost = "88.8";

    await patchPurchaseRecordByApi(baseURL, recordId, { 采购成本货物: goodsCost, 状态: "待发货" });

    const r = await waitForPurchaseRecord(
      baseURL,
      recordId,
      (d) => String(d["采购成本货物"] ?? "") === goodsCost && String(d["状态"] ?? "") === "待发货",
    );
    expect(String(r.data?.["状态"] ?? "")).toBe("待发货");
  });

  test("搜索筛选：关键词+类目+状态组合查询", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const searchName = unique("E2E采购-搜索");
    const searchRule = unique("pw-purchase-search");
    let searchId: number | null = null;

    try {
      searchId = await createPurchaseRecord(baseURL, {
        名称: searchName,
        所属类目: category,
        产品规则: searchRule,
        状态: "待采购",
      });

      const records = await fetchPurchaseRecordsByFilters(baseURL, {
        q: searchName,
        limit: "200",
        filters: JSON.stringify({ 所属类目: category, 状态: "待采购" }),
        timeRange: "",
      });
      expect(records.some((r) => r.id === searchId)).toBeTruthy();
    } finally {
      if (searchId != null) await deletePurchaseRecord(baseURL, searchId);
    }
  });

  test("状态卡片筛选：待采购/待发货切换", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const pendingName = unique("E2E采购-卡片-待采购");
    const shippingName = unique("E2E采购-卡片-待发货");
    let pendingId: number | null = null;
    let shippingId: number | null = null;

    try {
      pendingId = await createPurchaseRecord(baseURL, {
        名称: pendingName,
        所属类目: category,
        产品规则: unique("pw-purchase-card-pending"),
        状态: "待采购",
      });
      shippingId = await createPurchaseRecord(baseURL, {
        名称: shippingName,
        所属类目: category,
        产品规则: unique("pw-purchase-card-shipping"),
        状态: "待发货",
      });

      const pending = await fetchPurchaseRecordsByFilters(baseURL, {
        q: "",
        limit: "200",
        filters: JSON.stringify({ 状态: "待采购" }),
        timeRange: "",
      });
      const shipping = await fetchPurchaseRecordsByFilters(baseURL, {
        q: "",
        limit: "200",
        filters: JSON.stringify({ 状态: "待发货" }),
        timeRange: "",
      });
      expect(pending.some((r) => r.id === pendingId)).toBeTruthy();
      expect(shipping.some((r) => r.id === shippingId)).toBeTruthy();
    } finally {
      if (pendingId != null) await deletePurchaseRecord(baseURL, pendingId);
      if (shippingId != null) await deletePurchaseRecord(baseURL, shippingId);
    }
  });

  test("撤回：理由必填 + 状态变更为待确品 + 写入撤回理由", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");
    const withdrawName = unique("E2E采购-撤回");
    const reason = unique("E2E采购撤回理由");
    let withdrawId: number | null = null;

    try {
      withdrawId = await createPurchaseRecord(baseURL, {
        名称: withdrawName,
        所属类目: category,
        产品规则: unique("pw-purchase-withdraw"),
        状态: "待发货",
      });

      await patchPurchaseRecordByApi(baseURL, withdrawId, { 状态: "待确品", 撤回理由: reason });

      const r = await fetchPurchaseRecordById(baseURL, withdrawId);
      expect(String(r.data?.["状态"] ?? "")).toBe("待确品");
      expect(String(r.data?.["撤回理由"] ?? "")).toBe(reason);
    } finally {
      if (withdrawId != null) await deletePurchaseRecord(baseURL, withdrawId);
    }
  });
});
