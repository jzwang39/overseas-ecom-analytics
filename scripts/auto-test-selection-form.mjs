import fs from "node:fs";
import path from "node:path";

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const idx = s.indexOf("=");
    if (idx < 0) continue;
    const key = s.slice(0, idx).trim();
    let val = s.slice(idx + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function parseSetCookies(res) {
  const arr = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return (arr || []).map((h) => String(h).split(";")[0]).filter(Boolean);
}

function mergeCookies(...cookieKVs) {
  const m = new Map();
  for (const kv of cookieKVs.flat()) {
    const idx = kv.indexOf("=");
    if (idx <= 0) continue;
    m.set(kv.slice(0, idx), kv.slice(idx + 1));
  }
  return Array.from(m.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchWithTimeout(url, init = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, init = {}, ms = 10000) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchWithTimeout(url, init, ms);
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { res, text, json };
    } catch (e) {
      lastErr = e;
      const name = e && typeof e === "object" && "name" in e ? String(e.name) : "";
      if (name === "AbortError") continue;
      throw e;
    }
  }
  throw lastErr;
}

function mustEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
  }
}

function must(predicate, label) {
  if (!predicate) throw new Error(label);
}

async function main() {
  const repo = process.cwd();
  loadEnvFile(path.join(repo, ".env.local"));

  const base = process.env.TEST_BASE_URL || "http://localhost:3000";
  const username = process.env.INITIAL_SUPER_ADMIN_USERNAME || "";
  const password = process.env.INITIAL_SUPER_ADMIN_PASSWORD || "";
  must(username && password, "缺少 INITIAL_SUPER_ADMIN_USERNAME / INITIAL_SUPER_ADMIN_PASSWORD，无法自动登录测试");

  const t0 = Date.now();

  const csrf = await fetchJson(`${base}/api/auth/csrf`, { redirect: "manual" }, 120000);
  must(csrf.json?.csrfToken, "获取 csrfToken 失败");
  const csrfCookies = parseSetCookies(csrf.res);

  const loginBody = new URLSearchParams({
    csrfToken: csrf.json.csrfToken,
    username,
    password,
    callbackUrl: `${base}/work/ops/selection`,
    json: "true",
  });

  const loginRes = await fetchWithTimeout(
    `${base}/api/auth/callback/credentials`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: mergeCookies(csrfCookies),
      },
      body: loginBody,
    },
    120000,
  );

  const loginCookies = parseSetCookies(loginRes);
  const cookieHeader = mergeCookies(csrfCookies, loginCookies);

  const pre = await fetchJson(`${base}/api/workspace/ops.selection/records`, { headers: { cookie: cookieHeader } }, 120000);
  mustEqual(pre.res.status, 200, "登录后访问 records 失败");

  const name = `__AUTO_FORM_TEST__${Date.now()}__`;
  const specs = ["SPEC-A", "SPEC-B"];
  const baseData = {
    名称: name,
    所属类目: "帐篷",
    参考链接: "https://example.com/a",
    "平台在售价格（Min）": "10",
    "平台在售价格（Max）": "20",
    状态: "待选品",
    创建时间: new Date().toISOString(),
    最后更新时间: null,
    是否有专利风险: "否",
  };

  for (const spec of specs) {
    const data = { ...baseData, 产品规格: spec, 产品规则: spec };
    const r = await fetchJson(
      `${base}/api/workspace/ops.selection/records`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({ data }),
      },
      120000,
    );
    must(r.res.ok, `创建失败(${spec})：${r.res.status} ${r.text}`);
  }

  const afterCreate = await fetchJson(`${base}/api/workspace/ops.selection/records`, { headers: { cookie: cookieHeader } }, 120000);
  must(afterCreate.res.ok, `创建后拉取 records 失败：${afterCreate.res.status}`);
  const createdRows = (afterCreate.json?.records || []).filter((r) => String((r.data || {})["名称"] || "") === name);
  mustEqual(createdRows.length, specs.length, "创建的记录数不正确");
  const createdSpecs = new Set(createdRows.map((r) => String((r.data || {})["产品规格"] || "")));
  for (const s of specs) must(createdSpecs.has(s), `创建后缺少规格记录：${s}`);
  for (const r of createdRows) mustEqual(String((r.data || {})["状态"] || ""), "待选品", "保存后状态不正确");

  for (const r of createdRows) {
    const id = r.id;
    const nextData = { ...(r.data || {}), 状态: "待分配【询价】", 最后更新时间: new Date().toISOString() };
    const p = await fetchJson(
      `${base}/api/workspace/ops.selection/records/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({ data: nextData }),
      },
      120000,
    );
    must(p.res.ok, `提交(更新状态)失败(id=${id})：${p.res.status} ${p.text}`);
  }

  const afterSubmit = await fetchJson(`${base}/api/workspace/ops.selection/records`, { headers: { cookie: cookieHeader } }, 120000);
  must(afterSubmit.res.ok, `提交后拉取 records 失败：${afterSubmit.res.status}`);
  const submittedRows = (afterSubmit.json?.records || []).filter((r) => String((r.data || {})["名称"] || "") === name);
  mustEqual(submittedRows.length, specs.length, "提交后的记录数不正确");
  for (const r of submittedRows) mustEqual(String((r.data || {})["状态"] || ""), "待分配【询价】", "提交后状态不正确");

  const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  const ids = submittedRows.map((r) => r.id);
  process.stdout.write(JSON.stringify({ ok: true, base, name, ids, seconds }) + "\n");
}

await main();
