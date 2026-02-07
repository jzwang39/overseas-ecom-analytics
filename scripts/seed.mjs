import process from "node:process";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
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

async function main() {
  const username = process.env.INITIAL_SUPER_ADMIN_USERNAME ?? "";
  const password = process.env.INITIAL_SUPER_ADMIN_PASSWORD ?? "";
  const displayName = process.env.INITIAL_SUPER_ADMIN_DISPLAY_NAME ?? "超级管理员";

  if (!username || !password) {
    throw new Error("缺少环境变量 INITIAL_SUPER_ADMIN_USERNAME / INITIAL_SUPER_ADMIN_PASSWORD");
  }

  const config = getDbConfig();
  const pool = mysql.createPool({ ...config, connectionLimit: 10 });
  const conn = await pool.getConnection();

  try {
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1",
      [username],
    );
    if (existing.length > 0) {
      process.stdout.write("初始超级管理员已存在，跳过\n");
      return;
    }

    const [superAdmins] = await conn.query(
      "SELECT id FROM users WHERE permission_level = 'super_admin' AND deleted_at IS NULL LIMIT 1",
    );
    if (superAdmins.length > 0) {
      process.stdout.write("已存在超级管理员用户，跳过\n");
      return;
    }

    const defaultMenuKeys = JSON.stringify([
      "ops.selection",
      "ops.inquiry",
      "ops.pricing",
      "ops.confirm",
      "ops.purchase",
      "ops.first_leg_logistics",
      "ops.sales_ops",
      "ops.inventory_turnover",
      "finance.sales_data",
      "finance.warehouse_cost",
      "finance.staff_cost",
      "finance.penalty_amount",
      "finance.roi",
      "finance.product_strategy",
      "finance.ops_performance",
      "dashboard.sku_profit",
      "dashboard.selection_purchase",
      "dashboard.ops_review",
      "settings.users",
      "settings.roles",
      "settings.categories",
      "settings.logs",
    ]);

    const [roleResult] = await conn.query(
      "INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))",
      ["默认部门", "系统默认角色", defaultMenuKeys],
    );

    const roleId = roleResult.insertId;
    const passwordHash = await bcrypt.hash(password, 12);
    await conn.query(
      "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'super_admin', ?)",
      [username, displayName, passwordHash, roleId],
    );

    process.stdout.write("已创建初始超级管理员\n");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
