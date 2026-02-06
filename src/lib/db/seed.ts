import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { hashPassword } from "../security/password";
import { ensureDatabaseMigrationsApplied } from "./migrate";
import { getPool } from "./pool";

const globalForSeed = globalThis as typeof globalThis & {
  __initialSeedPromise?: Promise<void>;
};

export async function ensureInitialSuperAdmin() {
  if (!globalForSeed.__initialSeedPromise) {
    globalForSeed.__initialSeedPromise = (async () => {
      await ensureDatabaseMigrationsApplied();

      const username = process.env.INITIAL_SUPER_ADMIN_USERNAME ?? "";
      const password = process.env.INITIAL_SUPER_ADMIN_PASSWORD ?? "";
      const displayName = process.env.INITIAL_SUPER_ADMIN_DISPLAY_NAME ?? "超级管理员";

      if (!username || !password) return;

      const pool = getPool();
      const [superAdmins] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM users WHERE permission_level = 'super_admin' AND deleted_at IS NULL LIMIT 1",
      );
      if (superAdmins.length > 0) return;

      const [existingUsername] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1",
        [username],
      );
      if (existingUsername.length > 0) return;

      const menuKeys = JSON.stringify([
        "ops.selection",
        "ops.selection_candidates",
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
        "dashboard.inventory_turnover_board",
        "dashboard.ops_review",
        "settings.users",
        "settings.roles",
        "settings.categories",
        "settings.logs",
      ]);

      const [roleResult] = await pool.query<ResultSetHeader>(
        "INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))",
        ["默认部门", "系统默认角色", menuKeys],
      );

      const passwordHash = await hashPassword(password);
      await pool.query<ResultSetHeader>(
        "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'super_admin', ?)",
        [username, displayName, passwordHash, roleResult.insertId],
      );
    })();
  }

  await globalForSeed.__initialSeedPromise;
}
