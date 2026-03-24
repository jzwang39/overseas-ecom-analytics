import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

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
        timeout: 3_000,
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

async function waitForHealthy(url, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = await requestCode(url);
    if (code >= 200 && code < 500 && code !== 502) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Server not ready: ${url}`);
}

function run(cmd, cmdArgs, env, opts = {}) {
  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    env,
    ...opts,
  });
  return child;
}

async function pickPort() {
  const explicit = Number(process.env.E2E_PORT || "");
  const candidates = (process.env.E2E_PORTS || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  if (explicit) return explicit;
  if (candidates.length > 0) return candidates[0];
  return 40000 + Math.floor(Math.random() * 20000);
}

async function main() {
  loadEnvLocal(process.cwd());
  const ports = new Set();
  const explicit = Number(process.env.E2E_PORT || "");
  if (explicit) ports.add(explicit);
  ports.add(await pickPort());
  for (let i = 0; i < 8; i++) ports.add(40000 + Math.floor(Math.random() * 20000));

  const build = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { ...process.env });
  const buildCode = await new Promise((resolve) => build.on("exit", resolve));
  if (buildCode !== 0) process.exit(typeof buildCode === "number" ? buildCode : 1);

  for (const port of ports) {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
    const env = { ...process.env, NEXTAUTH_URL: baseURL, PLAYWRIGHT_BASE_URL: baseURL, E2E_PORT: String(port) };
    const server = run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "start", "--", "-p", String(port)],
      env,
    );
    const ok = await Promise.race([
      waitForHealthy(`${baseURL}/auth/login`, 240_000).then(() => true),
      new Promise((resolve) => server.once("exit", () => resolve(false))),
    ]);
    if (!ok) {
      server.kill("SIGTERM");
      continue;
    }
    try {
      const pw = run(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "test", ...args], env);
      const code = await new Promise((resolve) => pw.on("exit", resolve));
      process.exit(typeof code === "number" ? code : 1);
    } finally {
      server.kill("SIGTERM");
    }
  }

  throw new Error("Failed to start server on any port");
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
