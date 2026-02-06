import fs from "node:fs";
import path from "node:path";

function stripQuotes(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function loadEnv() {
  const candidates = [".env.local", ".env"];
  for (const filename of candidates) {
    const fullPath = path.join(process.cwd(), filename);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const idx = line.indexOf("=");
      if (idx <= 0) continue;

      const key = line.slice(0, idx).trim();
      const value = stripQuotes(line.slice(idx + 1));
      if (!key) continue;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

