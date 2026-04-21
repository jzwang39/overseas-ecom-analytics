import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

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

test.describe("菜单与页面权限", () => {
  let adminState = "";
  let inquiryState = "";

  test.beforeAll(async () => {
    const authDir = path.join(process.cwd(), "e2e", ".auth");
    adminState = path.join(authDir, "storage.json");
    inquiryState = path.join(authDir, "inquiry.json");
    await Promise.all([fs.access(adminState), fs.access(inquiryState)]);
  });

  test("P1：询价角色只显示被授权菜单并隐藏配置入口", async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    await runAs(browser, baseURL, inquiryState, async (page) => {
      await page.goto("/work");
      await expect(page.getByRole("link", { name: "询价" })).toBeVisible();
      await expect(page.getByRole("link", { name: "选品" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "核价" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "配置管理" })).toHaveCount(0);
    });
  });

  test("P1：询价角色直达无权限工作台会被重定向回工作台首页", async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    await runAs(browser, baseURL, inquiryState, async (page) => {
      await page.goto("/work/ops/selection");
      await page.waitForURL("**/work", { timeout: 60_000 });
      await expect(page).toHaveURL(/\/work$/);
      await expect(page.getByText("工作台首页")).toBeVisible();
      await expect(page.getByRole("link", { name: "询价" })).toBeVisible();
      await expect(page.getByRole("link", { name: "选品" })).toHaveCount(0);
    });
  });

  test("P1：普通用户进入配置页会被重定向，管理员可正常访问配置页", async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    await runAs(browser, baseURL, inquiryState, async (page) => {
      await page.goto("/settings/users");
      await page.waitForURL("**/work", { timeout: 60_000 });
      await expect(page).toHaveURL(/\/work$/);
      await expect(page.getByText("工作台首页")).toBeVisible();
    });

    await runAs(browser, baseURL, adminState, async (page) => {
      await page.goto("/settings/users");
      await expect(page).toHaveURL(/\/settings\/users$/);
      await expect(page.getByRole("link", { name: "用户管理" })).toBeVisible();
      await expect(page.getByText("配置管理")).toBeVisible();
      await expect(page.getByText("新增用户")).toBeVisible();
    });
  });
});
