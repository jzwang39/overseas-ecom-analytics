import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

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

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mergeSetCookies(jar, headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const it of list) {
    const nv = String(it).split(";")[0] ?? "";
    const idx = nv.indexOf("=");
    if (idx <= 0) continue;
    const name = nv.slice(0, idx).trim();
    const value = nv.slice(idx + 1);
    if (!name) continue;
    jar.set(name, value);
  }
}

function cookieHeader(jar) {
  const parts = [];
  for (const [k, v] of jar.entries()) parts.push(`${k}=${v}`);
  return parts.join("; ");
}

async function httpJson(baseURL, jar, method, pathname, body) {
  const url = new URL(pathname, baseURL).toString();
  const headers = new Headers();
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("cookie", cookie);
  if (body != null && !(body instanceof URLSearchParams)) headers.set("content-type", "application/json");

  const timeoutMs = Number(process.env.TEST_HTTP_TIMEOUT_MS || "120000");
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body == null ? undefined : body instanceof URLSearchParams ? body : JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timer);
      mergeSetCookies(jar, res.headers);
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      return { res, json };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("request failed");
}

async function signInCredentials(baseURL, jar, username, password) {
  const csrf = await httpJson(baseURL, jar, "GET", "/api/auth/csrf", null);
  assert.equal(csrf.res.status, 200);
  assert.ok(csrf.json && typeof csrf.json.csrfToken === "string");

  const params = new URLSearchParams();
  params.set("csrfToken", csrf.json.csrfToken);
  params.set("username", username);
  params.set("password", password);
  params.set("callbackUrl", "/work");
  params.set("json", "true");

  const cb = await httpJson(baseURL, jar, "POST", "/api/auth/callback/credentials", params);
  assert.ok(cb.res.status === 200 || cb.res.status === 302);

  const session = await httpJson(baseURL, jar, "GET", "/api/auth/session", null);
  assert.equal(session.res.status, 200);
  assert.ok(session.json && typeof session.json.user?.id === "string" && session.json.user.id);
}

async function ensureAdmin(conn, username, password) {
  const [roleRows] = await conn.query("SELECT id FROM roles WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1");
  const roleList = Array.isArray(roleRows) ? roleRows : [];
  let roleId =
    roleList.length > 0 && Number.isFinite(Number(roleList[0]?.id)) ? Number(roleList[0]?.id) : null;
  if (!roleId) {
    const menuKeys = JSON.stringify([]);
    const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
      "E2E默认角色",
      "E2E",
      menuKeys,
    ]);
    roleId = Number(res.insertId ?? 0);
  }

  const hash = await bcrypt.hash(password, 12);
  const [updateRes] = await conn.query(
    "UPDATE users SET password_hash = ?, permission_level = 'super_admin', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
    [hash, roleId, username],
  );
  if (Number(updateRes.affectedRows ?? 0) > 0) return;
  await conn.query(
    "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'super_admin', ?)",
    [username, "自动化测试管理员", hash, roleId],
  );
}

async function getPurchaseRow(conn, id) {
  const [rows] = await conn.query(
    `
      SELECT
        id,
        workspace_key,
        data,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."状态"')) AS status,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."箱规"')) AS box_spec,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."出货箱数"')) AS box_count,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."下单数"')) AS order_total,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."采购成本总额"')) AS cost_total,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."采购成本货物"')) AS cost_goods,
        JSON_UNQUOTE(JSON_EXTRACT(data, '$."最后更新时间"')) AS updated_at
      FROM workspace_records
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [id],
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function main() {
  loadEnvLocal(process.cwd());
  const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:3004";
  const username = process.env.E2E_USERNAME || process.env.INITIAL_SUPER_ADMIN_USERNAME || "admin";
  const password = process.env.E2E_PASSWORD || process.env.INITIAL_SUPER_ADMIN_PASSWORD || "StrongPass123";

  const dbHost = process.env.DB_HOST || "127.0.0.1";
  const dbPort = Number(process.env.DB_PORT || "3306");
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "";
  const dbDatabase = process.env.DB_DATABASE || "";
  assert.ok(dbDatabase, "DB_DATABASE missing");

  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
    multipleStatements: false,
  });

  let categoryId = null;
  let recordId = null;
  const jar = new Map();
  try {
    console.log(`[purchase-form] baseURL=${baseURL}`);
    await ensureAdmin(conn, username, password);
    console.log("[purchase-form] admin ensured");
    await signInCredentials(baseURL, jar, username, password);
    console.log("[purchase-form] signed in");

    const categoryName = unique("E2E类目");
    const [catRes] = await conn.query("INSERT INTO categories(name) VALUES (?)", [categoryName]);
    categoryId = Number(catRes.insertId ?? 0);
    assert.ok(categoryId > 0);
    console.log(`[purchase-form] category created: ${categoryName}`);

    const productName = unique("E2E采购-表单修改");
    const productRule = unique("pw-purchase-form");

    const create = await httpJson(baseURL, jar, "POST", "/api/workspace/ops.purchase/records", {
      data: {
        名称: productName,
        所属类目: categoryName,
        产品规则: productRule,
        状态: "待采购",
        箱规: "",
        出货箱数: "",
        下单数: "",
        采购成本总额: "",
        采购成本货物: "",
      },
    });
    assert.equal(create.res.status, 200);
    assert.ok(create.json && typeof create.json.id === "string");
    recordId = Number(create.json.id);
    assert.ok(Number.isFinite(recordId) && recordId > 0);
    console.log(`[purchase-form] record created: id=${recordId}`);

    const boxSpecValue = "11";
    const boxCountValue = "2";
    const orderTotalValue = "22";
    const totalCostValue = "123.45";

    const existing = await getPurchaseRow(conn, recordId);
    assert.ok(existing && existing.data, "record not found in db after create");
    const currentData = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data;
    assert.ok(currentData && typeof currentData === "object" && !Array.isArray(currentData));

    const save = await httpJson(baseURL, jar, "PATCH", `/api/workspace/ops.purchase/records/${recordId}`, {
      data: {
        ...currentData,
        箱规: boxSpecValue,
        出货箱数: boxCountValue,
        下单数: orderTotalValue,
        采购成本总额: totalCostValue,
        状态: "待采购",
      },
    });
    assert.equal(save.res.status, 200);
    console.log("[purchase-form] save patched");

    const afterSave = await getPurchaseRow(conn, recordId);
    assert.ok(afterSave, "purchase record missing after save");
    assert.equal(afterSave.workspace_key, "ops.purchase");
    assert.equal(afterSave.status, "待采购");
    assert.equal(afterSave.box_spec ?? "", boxSpecValue);
    assert.equal(afterSave.box_count ?? "", boxCountValue);
    assert.equal(afterSave.order_total ?? "", orderTotalValue);
    assert.equal(afterSave.cost_total ?? "", totalCostValue);
    assert.ok(String(afterSave.updated_at ?? "").trim(), "最后更新时间 not set");

    const goodsCostValue = "88.8";
    const currentAfterSave = typeof afterSave.data === "string" ? JSON.parse(afterSave.data) : afterSave.data;
    const submit = await httpJson(baseURL, jar, "PATCH", `/api/workspace/ops.purchase/records/${recordId}`, {
      data: {
        ...(currentAfterSave && typeof currentAfterSave === "object" && !Array.isArray(currentAfterSave) ? currentAfterSave : {}),
        箱规: boxSpecValue,
        出货箱数: boxCountValue,
        下单数: orderTotalValue,
        采购成本总额: totalCostValue,
        采购成本货物: goodsCostValue,
        状态: "待发货",
      },
    });
    assert.equal(submit.res.status, 200);
    console.log("[purchase-form] submit patched");

    const afterSubmit = await getPurchaseRow(conn, recordId);
    assert.ok(afterSubmit, "purchase record missing after submit");
    assert.equal(afterSubmit.status, "待发货");
    assert.equal(afterSubmit.cost_goods ?? "", goodsCostValue);

    const del = await httpJson(baseURL, jar, "DELETE", `/api/workspace/ops.purchase/records/${recordId}`, null);
    assert.equal(del.res.status, 200);
    recordId = null;
    console.log("[purchase-form] record deleted");

    await conn.query("UPDATE categories SET deleted_at = NOW() WHERE id = ? LIMIT 1", [categoryId]);
    categoryId = null;
    console.log("[purchase-form] category deleted");
  } finally {
    try {
      if (recordId) await conn.query("UPDATE workspace_records SET deleted_at = NOW() WHERE id = ? LIMIT 1", [recordId]);
    } catch {}
    try {
      if (categoryId) await conn.query("UPDATE categories SET deleted_at = NOW() WHERE id = ? LIMIT 1", [categoryId]);
    } catch {}
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
