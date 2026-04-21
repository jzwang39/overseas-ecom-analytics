import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { request } from "@playwright/test";

function loadEnvLocal(root = process.cwd()) {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (!k) continue;
    if (process.env[k] != null) continue;
    process.env[k] = v;
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
    });
    child.on("exit", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

function requestCode(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: 4_000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}


async function warmupRoutes(baseURL, storageStatePath) {
  const routes = [
    // 页面路由
    "/work/ops/selection",
    "/work/ops/inquiry",
    "/work/ops/pricing",
    "/work/ops/confirm",
    "/work/ops/purchase",
    "/settings/users",
    // 列表 API 路由（GET）
    "/api/workspace/ops.selection/records?q=__warmup__&limit=1&filters=%7B%7D&timeRange=",
    "/api/workspace/ops.inquiry/records?q=__warmup__&limit=1&filters=%7B%7D&timeRange=",
    "/api/workspace/ops.pricing/records?q=__warmup__&limit=1&filters=%7B%7D&timeRange=",
    "/api/workspace/ops.confirm/records?q=__warmup__&limit=1&filters=%7B%7D&timeRange=",
    "/api/workspace/ops.purchase/records?q=__warmup__&limit=1&filters=%7B%7D&timeRange=",
    "/api/admin/categories",
    "/api/config/categories",
    "/api/config/last-mile-pricing",
    "/api/admin/users",
    // NextAuth 路由（auth.setup.ts 会调用这些，必须提前编译）
    "/api/auth/csrf",
    "/api/auth/session",
    // 单条记录路由（GET，ID=0 返回 404，但编译路由文件）
    "/api/workspace/ops.selection/records/0",
    "/api/workspace/ops.purchase/records/0",
  ];
  // 串行编译，避免并发写 manifest 导致 JSON 损坏
  console.log("[preflight] 预热路由（串行，触发 Next.js 按需编译）...");
  const api = await request.newContext({ baseURL, storageState: storageStatePath });
  try {
    for (const route of routes) {
      try {
        const res = await api.get(route, { timeout: 180_000 });
        console.log(`[preflight] warmup ${route} → ${res.status()}`);
      } catch {
        console.warn(`[preflight] warmup ${route} → timeout/error`);
      }
    }
    console.log("[preflight] 所有路由预热完成。");
  } finally {
    await api.dispose();
  }
}

async function waitForHttpOk(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await requestCode(url);
    if (status >= 200 && status < 500 && status !== 502) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function hasSessionCookie(state) {
  if (!state || !Array.isArray(state.cookies)) return false;
  return state.cookies.some((c) => typeof c?.name === "string" && c.name.includes("next-auth.session-token"));
}

async function verifySession(baseURL, storageStatePath, expectedUsername) {
  if (!fs.existsSync(storageStatePath)) return false;
  const state = await readJsonSafe(storageStatePath);
  if (!hasSessionCookie(state)) return false;

  const api = await request.newContext({ baseURL, storageState: storageStatePath });
  try {
    const sessionRes = await api.get("/api/auth/session");
    if (!sessionRes.ok()) return false;
    const sessionJson = (await sessionRes.json().catch(() => null)) ?? {};
    return String(sessionJson?.user?.username ?? "") === expectedUsername;
  } catch {
    return false;
  } finally {
    await api.dispose();
  }
}

async function verifyAllSessions(baseURL, authDir) {
  const checks = [
    {
      file: path.join(authDir, "storage.json"),
      username: process.env.E2E_USERNAME || process.env.INITIAL_SUPER_ADMIN_USERNAME || "admin",
    },
    {
      file: path.join(authDir, "inquiry-admin.json"),
      username: process.env.E2E_INQUIRY_ADMIN_USERNAME || "e2e_inquiry_admin",
    },
    {
      file: path.join(authDir, "inquiry.json"),
      username: process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry",
    },
  ];

  const failed = [];
  for (const item of checks) {
    const ok = await verifySession(baseURL, item.file, item.username);
    if (!ok) failed.push(item.file);
  }
  return failed;
}

async function main() {
  loadEnvLocal(process.cwd());
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3004";
  const authDir = path.join(process.cwd(), "e2e", ".auth");
  const storageStatePath = path.join(authDir, "storage.json");

  console.log(`[preflight] baseURL=${baseURL}`);
  const up = await waitForHttpOk(`${baseURL}/api/auth/csrf`, 90_000);
  if (!up) {
    console.error(`[preflight] 服务不可用: ${baseURL}/api/auth/csrf`);
    console.error("[preflight] 请先启动 Next.js 服务后重试。");
    process.exit(1);
  }

  let failedStates = await verifyAllSessions(baseURL, authDir);
  if (failedStates.length > 0) {
    console.log(`[preflight] 发现无效登录态，准备重建: ${failedStates.join(", ")}`);
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const setupCode = await run(npxCmd, [
      "playwright",
      "test",
      "e2e/auth.setup.ts",
      "--project=setup",
      "--workers=1",
      "--no-deps",
    ]);

    if (setupCode !== 0) {
      console.error("[preflight] auth.setup 执行失败，无法自动修复登录态。");
      process.exit(setupCode);
    }

    failedStates = await verifyAllSessions(baseURL, authDir);
    if (failedStates.length > 0) {
      console.error(`[preflight] 登录态仍然无效: ${failedStates.join(", ")}`);
      process.exit(1);
    }

    console.log("[preflight] 登录态重建成功。");
  } else {
    console.log("[preflight] 鉴权状态检查通过。");
  }

  await warmupRoutes(baseURL, storageStatePath);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
