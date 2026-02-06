import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import mysql from "mysql2/promise";
import { loadEnv } from "./load-env.mjs";

loadEnv();

function getDbConfig() {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = Number(process.env.DB_PORT ?? "3306");
  const user = process.env.DB_USER ?? "root";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_DATABASE ?? "";

  if (!database) {
    throw new Error("缺少环境变量 DB_DATABASE");
  }

  return { host, port, user, password, database };
}

async function ensureSchemaMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getAppliedVersions(conn) {
  const [rows] = await conn.query("SELECT version FROM schema_migrations");
  return new Set(rows.map((r) => r.version));
}

async function applyMigration(conn, version, sql) {
  await conn.query(sql);
  await conn.query("INSERT INTO schema_migrations(version) VALUES (?)", [version]);
}

async function main() {
  const config = getDbConfig();
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 10,
    multipleStatements: true,
  });

  const conn = await pool.getConnection();
  try {
    await ensureSchemaMigrationsTable(conn);
    const applied = await getAppliedVersions(conn);

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
      await applyMigration(conn, version, sql);
      process.stdout.write(`已应用迁移：${version}\n`);
    }

    process.stdout.write("迁移完成\n");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
