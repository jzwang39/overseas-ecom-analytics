import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

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
        timeout: 2_000,
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

async function waitForHealthy(url, timeoutMs = 240_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = await requestCode(url);
    if (code >= 200 && code < 500 && code !== 502) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Server not ready: ${url}`);
}

function run(cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    env: { ...process.env },
    ...opts,
  });
  return child;
}

async function main() {
  loadEnvLocal(process.cwd());
  const args = process.argv.slice(2);

  const candidates = (process.env.E2E_PORTS || "3004,3100,3500").split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
  let port = candidates[0] || 3004;
  let baseURL = `http://127.0.0.1:${port}`;

  let serverStarted = false;
  for (const p of candidates) {
    const u = `http://127.0.0.1:${p}`;
    const code = await requestCode(`${u}/auth/login`);
    if (code >= 200 && code < 500 && code !== 502) {
      port = p;
      baseURL = u;
      break;
    }
    port = p;
    baseURL = u;
    serverStarted = true;
    break;
  }

  let server = null;
  if (serverStarted) {
    const build = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
    const buildCode = await new Promise((resolve) => build.on("exit", resolve));
    if (buildCode !== 0) process.exit(typeof buildCode === "number" ? buildCode : 1);
    server = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "--", "-p", String(port)], {
      env: { ...process.env, NEXTAUTH_URL: baseURL, CYPRESS_BASE_URL: baseURL },
    });
    await waitForHealthy(`${baseURL}/auth/login`, 600_000);
  }

  const cy = run(process.platform === "win32" ? "npx.cmd" : "npx", ["cypress", "run", ...args], {
    env: { ...process.env, CYPRESS_BASE_URL: baseURL },
  });
  const code = await new Promise((resolve) => cy.on("exit", resolve));
  if (server) server.kill("SIGTERM");
  process.exit(typeof code === "number" ? code : 1);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});

