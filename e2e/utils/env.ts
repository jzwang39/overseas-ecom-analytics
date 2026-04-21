import fs from "node:fs";
import path from "node:path";

export function loadEnvLocal(projectRoot = process.cwd()) {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (!key) continue;
    if (key in process.env) continue;
    out[key] = value;
    process.env[key] = value;
  }
  return out;
}

