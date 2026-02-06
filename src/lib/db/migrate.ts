import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./pool";

const globalForDbInit = globalThis as typeof globalThis & {
  __dbInitPromise?: Promise<void>;
};

async function ensureSchemaMigrationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getAppliedVersions() {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { version: string })[]>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(rows.map((r) => r.version));
}

async function applyMigration(version: string, sql: string) {
  const pool = getPool();
  await pool.query(sql);
  await pool.query("INSERT INTO schema_migrations(version) VALUES (?)", [version]);
}

export async function ensureDatabaseMigrationsApplied() {
  if (!globalForDbInit.__dbInitPromise) {
    globalForDbInit.__dbInitPromise = (async () => {
      await ensureSchemaMigrationsTable();
      const applied = await getAppliedVersions();
      const migrationsDir = path.join(process.cwd(), "db", "migrations");
      const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".sql"))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

      for (const file of files) {
        const version = file.replace(/\.sql$/, "");
        if (applied.has(version)) continue;
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await applyMigration(version, sql);
      }
    })();
  }
  await globalForDbInit.__dbInitPromise;
}
