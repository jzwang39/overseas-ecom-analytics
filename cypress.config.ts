import { defineConfig } from "cypress";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

function envString(key: string, fallback = "") {
  const v = process.env[key];
  return typeof v === "string" ? v : fallback;
}

async function ensureRole(conn: mysql.Connection, name: string) {
  const [rows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", [name]);
  const list = Array.isArray(rows) ? (rows as Array<{ id?: unknown }>) : [];
  if (list.length > 0 && Number.isFinite(Number(list[0]?.id))) return Number(list[0]?.id);
  const menuKeys = JSON.stringify([]);
  const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
    name,
    "E2E",
    menuKeys,
  ]);
  return Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
}

async function ensureUser(params: {
  username: string;
  password: string;
  displayName: string;
  permissionLevel: "user" | "admin" | "super_admin";
  roleName: string;
}) {
  const dbHost = envString("DB_HOST", "127.0.0.1");
  const dbPort = Number(envString("DB_PORT", "3306"));
  const dbUser = envString("DB_USER", "root");
  const dbPassword = envString("DB_PASSWORD", "");
  const dbDatabase = envString("DB_DATABASE", "");
  if (!dbDatabase) throw new Error("DB_DATABASE is required for Cypress E2E");

  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
    multipleStatements: false,
  });
  try {
    const roleId = await ensureRole(conn, params.roleName);
    const passwordHash = await bcrypt.hash(params.password, 12);
    const [updateRes] = await conn.query(
      "UPDATE users SET display_name = ?, password_hash = ?, permission_level = ?, is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
      [params.displayName, passwordHash, params.permissionLevel, roleId, params.username],
    );
    const affected = Number((updateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
    if (affected <= 0) {
      await conn.query(
        "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, ?, ?)",
        [params.username, params.displayName, passwordHash, params.permissionLevel, roleId],
      );
    }
  } finally {
    await conn.end();
  }
  return true;
}

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || "http://127.0.0.1:3004",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    setupNodeEvents(on) {
      on("task", {
        "db:ensureAdmin"(args: { username: string; password: string }) {
          return ensureUser({
            username: args.username,
            password: args.password,
            displayName: "E2E超级管理员",
            permissionLevel: "super_admin",
            roleName: "E2E超级管理员",
          });
        },
        "db:ensureInquiryAssignee"(args: { username: string; password: string }) {
          return ensureUser({
            username: args.username,
            password: args.password,
            displayName: "E2E询价员",
            permissionLevel: "user",
            roleName: "询价员",
          });
        },
      });
    },
  },
});
