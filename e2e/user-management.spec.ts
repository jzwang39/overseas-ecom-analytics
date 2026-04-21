import { expect, request, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import mysql from "mysql2/promise";
import { loadEnvLocal } from "./utils/env";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  permission_level: "super_admin" | "admin" | "user";
  role_id: number | null;
  is_disabled: 0 | 1;
  deleted_at: string | null;
};

type RoleIdRow = RowDataPacket & {
  id: number;
};

type DbUserRow = RowDataPacket & UserRow;

type RoleRow = RowDataPacket & {
  id: number;
  name: string;
};

type CreateUserPayload = {
  username: string;
  displayName?: string;
  initialPassword: string;
  permissionLevel?: "super_admin" | "admin" | "user";
  roleId?: string | null;
};

async function withDb<T>(fn: (conn: mysql.Connection) => Promise<T>) {
  loadEnvLocal(process.cwd());
  const dbDatabase = process.env.DB_DATABASE || "";
  if (!dbDatabase) throw new Error("DB_DATABASE missing");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: dbDatabase,
    multipleStatements: false,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

async function findRoleIdByName(name: string) {
  return withDb(async (conn) => {
    const [rows] = await conn.query<RoleIdRow[]>(
      "SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1",
      [name],
    );
    return Number(rows[0]?.id ?? 0);
  });
}

async function ensureRole(name: string, menuKeys: string[]) {
  return withDb(async (conn) => {
    const [rows] = await conn.query<RoleRow[]>(
      "SELECT id, name FROM roles WHERE name = ? ORDER BY id DESC LIMIT 1",
      [name],
    );
    if (rows[0]?.id) {
      await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [
        JSON.stringify(menuKeys),
        rows[0].id,
      ]);
      return rows[0].id;
    }

    const [result] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
      name,
      "E2E",
      JSON.stringify(menuKeys),
    ]);
    return Number((result as { insertId?: number }).insertId ?? 0);
  });
}

async function findUserByUsername(username: string) {
  return withDb(async (conn) => {
    const [rows] = await conn.query<DbUserRow[]>(
      `
        SELECT id, username, display_name, permission_level, role_id, is_disabled, deleted_at
        FROM users
        WHERE username = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [username],
    );
    return rows[0] ?? null;
  });
}

async function softDeleteUser(username: string) {
  await withDb(async (conn) => {
    await conn.query("UPDATE users SET deleted_at = NOW() WHERE username = ? AND deleted_at IS NULL", [username]);
  });
}

async function createUserViaApi(baseURL: string, storageState: string, payload: CreateUserPayload) {
  const api = await request.newContext({ baseURL, storageState });
  try {
    const res = await api.post("/api/admin/users", { data: payload });
    const json = (await res.json().catch(() => null)) as null | { id?: string; error?: string };
    if (!res.ok() || !json?.id) {
      throw new Error(`create user failed: ${res.status()} ${JSON.stringify(json)}`);
    }
    return Number(json.id);
  } finally {
    await api.dispose();
  }
}

async function patchUserViaApi(
  baseURL: string,
  storageState: string,
  userId: number,
  payload: Record<string, unknown>,
) {
  const api = await request.newContext({ baseURL, storageState });
  try {
    const res = await api.patch(`/api/admin/users/${userId}`, { data: payload });
    const json = (await res.json().catch(() => null)) as null | { ok?: boolean; error?: string };
    return { ok: res.ok(), status: res.status(), json };
  } finally {
    await api.dispose();
  }
}

async function canLogin(baseURL: string, username: string, password: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const api = await request.newContext({ baseURL });
    try {
      const csrfRes = await api.get("/api/auth/csrf");
      const csrfJson = (await csrfRes.json().catch(() => null)) as null | { csrfToken?: string };
      const csrfToken = typeof csrfJson?.csrfToken === "string" ? csrfJson.csrfToken : "";
      if (!csrfRes.ok() || !csrfToken) {
        throw new Error(`load csrf failed: ${csrfRes.status()}`);
      }

      const signInRes = await api.post("/api/auth/callback/credentials?json=true", {
        form: {
          csrfToken,
          username,
          password,
          callbackUrl: "/work",
          json: "true",
        },
      });
      if (!signInRes.ok()) {
        throw new Error(`sign in failed: ${signInRes.status()}`);
      }

      const sessionRes = await api.get("/api/auth/session");
      const sessionJson = (await sessionRes.json().catch(() => null)) as null | { user?: { username?: string } };
      if (!sessionRes.ok()) {
        throw new Error(`session load failed: ${sessionRes.status()}`);
      }
      return String(sessionJson?.user?.username ?? "") === username;
    } catch {
      if (attempt === 3) break;
      await sleep(attempt * 1_000);
    } finally {
      await api.dispose();
    }
  }
  return false;
}

test.describe.serial("用户管理", () => {
  let adminState = "";
  let inquiryAdminState = "";
  let inquiryRoleId = 0;
  const cleanupUsernames = new Set<string>();

  test.beforeAll(async () => {
    const authDir = path.join(process.cwd(), "e2e", ".auth");
    adminState = path.join(authDir, "storage.json");
    inquiryAdminState = path.join(authDir, "inquiry-admin.json");
    await Promise.all([fs.access(adminState), fs.access(inquiryAdminState)]);
    inquiryRoleId = await ensureRole("询价员", ["ops.inquiry"]);
    if (!inquiryRoleId) {
      inquiryRoleId = await findRoleIdByName("询价员");
    }
    if (!inquiryRoleId) throw new Error("询价员角色不存在");
  });

  test.afterAll(async () => {
    await Promise.all(Array.from(cleanupUsernames, (username) => softDeleteUser(username)));
  });

  test("P1：超级管理员可创建用户并分配角色", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const username = unique("e2e-user-create");
    const displayName = "E2E用户创建";
    const password = "StrongPass123";
    cleanupUsernames.add(username);

    const userId = await createUserViaApi(baseURL, adminState, {
      username,
      displayName,
      initialPassword: password,
      permissionLevel: "user",
      roleId: String(inquiryRoleId),
    });
    expect(userId).toBeGreaterThan(0);

    const created = await findUserByUsername(username);
    expect(created).not.toBeNull();
    expect(created?.display_name).toBe(displayName);
    expect(created?.permission_level).toBe("user");
    expect(created?.role_id).toBe(inquiryRoleId);
    expect(created?.is_disabled).toBe(0);

    await expect.poll(async () => canLogin(baseURL, username, password), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeTruthy();
  });

  test("P1：禁用后用户无法登录，恢复后可重新登录", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const username = unique("e2e-user-disable");
    const password = "StrongPass123";
    cleanupUsernames.add(username);
    const userId = await createUserViaApi(baseURL, adminState, {
      username,
      displayName: "E2E禁用用户",
      initialPassword: password,
      permissionLevel: "user",
      roleId: String(inquiryRoleId),
    });
    expect(userId).toBeGreaterThan(0);

    await expect.poll(async () => canLogin(baseURL, username, password), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeTruthy();

    const disabledRes = await patchUserViaApi(baseURL, adminState, userId, { isDisabled: true });
    expect(disabledRes.ok).toBeTruthy();

    const disabled = await findUserByUsername(username);
    expect(disabled?.is_disabled).toBe(1);
    await expect.poll(async () => canLogin(baseURL, username, password), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeFalsy();

    const restoredRes = await patchUserViaApi(baseURL, adminState, userId, { isDisabled: false });
    expect(restoredRes.ok).toBeTruthy();

    const restored = await findUserByUsername(username);
    expect(restored?.is_disabled).toBe(0);
    await expect.poll(async () => canLogin(baseURL, username, password), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeTruthy();
  });

  test("P1：重置密码后旧密码失效，新密码可登录", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const username = unique("e2e-user-reset");
    const oldPassword = "StrongPass123";
    cleanupUsernames.add(username);
    const userId = await createUserViaApi(baseURL, adminState, {
      username,
      displayName: "E2E重置密码用户",
      initialPassword: oldPassword,
      permissionLevel: "user",
      roleId: String(inquiryRoleId),
    });
    expect(userId).toBeGreaterThan(0);

    await expect.poll(async () => canLogin(baseURL, username, oldPassword), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeTruthy();

    const newPassword = "StrongerPass456";
    const resetRes = await patchUserViaApi(baseURL, adminState, userId, { resetPassword: newPassword });
    expect(resetRes.ok).toBeTruthy();

    await expect.poll(async () => canLogin(baseURL, username, oldPassword), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeFalsy();
    await expect.poll(async () => canLogin(baseURL, username, newPassword), {
      timeout: 120_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
    }).toBeTruthy();
  });

  test("P1：管理员不能创建管理员或超级管理员账号", async ({ baseURL }) => {
    if (!baseURL) throw new Error("baseURL missing");

    const username = unique("e2e-admin-blocked");
    cleanupUsernames.add(username);

    const api = await request.newContext({ baseURL, storageState: inquiryAdminState });
    const createAdminRes = await api.post("/api/admin/users", {
      data: {
        username,
        displayName: "E2E管理员越权",
        initialPassword: "StrongPass123",
        permissionLevel: "admin",
        roleId: String(inquiryRoleId),
      },
    });
    const createAdminJson = (await createAdminRes.json().catch(() => null)) as null | { error?: string };
    expect(createAdminRes.status()).toBe(403);
    expect(createAdminJson?.error ?? "").toContain("管理员只能创建使用者账号");
    await api.dispose();

    expect(await findUserByUsername(username)).toBeNull();
  });
});
