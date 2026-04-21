import { request, test as setup } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "./utils/env";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

setup("登录并保存 storageState", async ({ baseURL }) => {
  setup.setTimeout(600_000);
  loadEnvLocal(process.cwd());
  const username = process.env.E2E_USERNAME || process.env.INITIAL_SUPER_ADMIN_USERNAME || "admin";
  const password = process.env.E2E_PASSWORD || process.env.INITIAL_SUPER_ADMIN_PASSWORD || "StrongPass123";
  const inquiryUsername = process.env.E2E_INQUIRY_ASSIGNEE_USERNAME || "e2e_inquiry";
  const inquiryPassword = process.env.E2E_INQUIRY_ASSIGNEE_PASSWORD || "StrongPass123";
  const inquiryOtherUsername = process.env.E2E_INQUIRY_OTHER_USERNAME || "e2e_inquiry_other";
  const inquiryOtherPassword = process.env.E2E_INQUIRY_OTHER_PASSWORD || "StrongPass123";
  const inquiryAdminUsername = process.env.E2E_INQUIRY_ADMIN_USERNAME || "e2e_inquiry_admin";
  const inquiryAdminPassword = process.env.E2E_INQUIRY_ADMIN_PASSWORD || "StrongPass123";
  const pricingOperatorUsername = process.env.E2E_PRICING_OPERATOR_USERNAME || "e2e_operator";
  const pricingOperatorPassword = process.env.E2E_PRICING_OPERATOR_PASSWORD || "StrongPass123";
  const inquiryMenuKeys = JSON.stringify(["ops.inquiry"]);
  const operatorMenuKeys = JSON.stringify(["ops.pricing"]);
  const authDir = path.join(process.cwd(), "e2e", ".auth");
  const adminOut = path.join(authDir, "storage.json");
  const inquiryOut = path.join(authDir, "inquiry.json");
  const inquiryOtherOut = path.join(authDir, "inquiry-other.json");
  const inquiryAdminOut = path.join(authDir, "inquiry-admin.json");
  const operatorOut = path.join(authDir, "operator.json");
  await fs.mkdir(authDir, { recursive: true });

  const dbHost = process.env.DB_HOST || "127.0.0.1";
  const dbPort = Number(process.env.DB_PORT || "3306");
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "";
  const dbDatabase = process.env.DB_DATABASE || "";

  if (dbDatabase) {
    const conn = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbDatabase,
      multipleStatements: false,
    });
    try {
      const [roleRows] = await conn.query("SELECT id FROM roles WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1");
      const list = Array.isArray(roleRows) ? (roleRows as Array<{ id?: unknown }>) : [];
      let roleId = list.length > 0 && Number.isFinite(Number(list[0]?.id)) ? Number(list[0]?.id) : null;
      if (!roleId) {
        const menuKeys = JSON.stringify([]);
        const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
          "E2E默认角色",
          "E2E",
          menuKeys,
        ]);
        roleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [updateRes] = await conn.query(
        "UPDATE users SET password_hash = ?, permission_level = 'super_admin', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
        [passwordHash, roleId, username],
      );
      const affected = Number((updateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
      if (affected <= 0) {
        await conn.query(
          "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'super_admin', ?)",
          [username, "E2E超级管理员", passwordHash, roleId],
        );
      }

      const [inqRoleRows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", [
        "询价员",
      ]);
      const inqRoleList = Array.isArray(inqRoleRows) ? (inqRoleRows as Array<{ id?: unknown }>) : [];
      let inqRoleId = inqRoleList.length > 0 && Number.isFinite(Number(inqRoleList[0]?.id)) ? Number(inqRoleList[0]?.id) : null;
      if (!inqRoleId) {
        const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
          "询价员",
          "E2E",
          inquiryMenuKeys,
        ]);
        inqRoleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
      } else {
        await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [
          inquiryMenuKeys,
          inqRoleId,
        ]);
      }

      const inquiryHash = await bcrypt.hash(inquiryPassword, 12);
      const [inqUpdateRes] = await conn.query(
        "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'user', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
        ["E2E询价员", inquiryHash, inqRoleId, inquiryUsername],
      );
      const inqAffected = Number((inqUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
      if (inqAffected <= 0) {
        await conn.query(
          "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'user', ?)",
          [inquiryUsername, "E2E询价员", inquiryHash, inqRoleId],
        );
      }

      const inquiryOtherHash = await bcrypt.hash(inquiryOtherPassword, 12);
      const [inqOtherUpdateRes] = await conn.query(
        "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'user', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
        ["E2E询价员-其他", inquiryOtherHash, inqRoleId, inquiryOtherUsername],
      );
      const inqOtherAffected = Number((inqOtherUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
      if (inqOtherAffected <= 0) {
        await conn.query(
          "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'user', ?)",
          [inquiryOtherUsername, "E2E询价员-其他", inquiryOtherHash, inqRoleId],
        );
      }

      const [inqAdminRoleRows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", [
        "询价管理员",
      ]);
      const inqAdminRoleList = Array.isArray(inqAdminRoleRows) ? (inqAdminRoleRows as Array<{ id?: unknown }>) : [];
      let inqAdminRoleId =
        inqAdminRoleList.length > 0 && Number.isFinite(Number(inqAdminRoleList[0]?.id))
          ? Number(inqAdminRoleList[0]?.id)
          : null;
      if (!inqAdminRoleId) {
        const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
          "询价管理员",
          "E2E",
          inquiryMenuKeys,
        ]);
        inqAdminRoleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
      } else {
        await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [
          inquiryMenuKeys,
          inqAdminRoleId,
        ]);
      }

      const inquiryAdminHash = await bcrypt.hash(inquiryAdminPassword, 12);
      const [inqAdminUpdateRes] = await conn.query(
        "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'admin', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
        ["E2E询价管理员", inquiryAdminHash, inqAdminRoleId, inquiryAdminUsername],
      );
      const inqAdminAffected = Number((inqAdminUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
      if (inqAdminAffected <= 0) {
        await conn.query(
          "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'admin', ?)",
          [inquiryAdminUsername, "E2E询价管理员", inquiryAdminHash, inqAdminRoleId],
        );
      }

      const [opRoleRows] = await conn.query("SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1", [
        "运营者",
      ]);
      const opRoleList = Array.isArray(opRoleRows) ? (opRoleRows as Array<{ id?: unknown }>) : [];
      let opRoleId = opRoleList.length > 0 && Number.isFinite(Number(opRoleList[0]?.id)) ? Number(opRoleList[0]?.id) : null;
      if (!opRoleId) {
        const [res] = await conn.query("INSERT INTO roles(name, description, menu_keys) VALUES (?, ?, CAST(? AS JSON))", [
          "运营者",
          "E2E",
          operatorMenuKeys,
        ]);
        opRoleId = Number((res as unknown as { insertId?: unknown }).insertId ?? 0);
      } else {
        await conn.query("UPDATE roles SET menu_keys = CAST(? AS JSON), deleted_at = NULL WHERE id = ?", [
          operatorMenuKeys,
          opRoleId,
        ]);
      }

      const operatorHash = await bcrypt.hash(pricingOperatorPassword, 12);
      const [opUpdateRes] = await conn.query(
        "UPDATE users SET display_name = ?, password_hash = ?, permission_level = 'user', is_disabled = 0, deleted_at = NULL, role_id = ? WHERE username = ?",
        ["E2E运营者", operatorHash, opRoleId, pricingOperatorUsername],
      );
      const opAffected = Number((opUpdateRes as unknown as { affectedRows?: unknown }).affectedRows ?? 0);
      if (opAffected <= 0) {
        await conn.query(
          "INSERT INTO users(username, display_name, password_hash, permission_level, role_id) VALUES (?, ?, ?, 'user', ?)",
          [pricingOperatorUsername, "E2E运营者", operatorHash, opRoleId],
        );
      }
    } finally {
      await conn.end();
    }
  }

  if (!baseURL) throw new Error("baseURL missing");

  const loginAndSave = async (user: string, pass: string, out: string) => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const api = await request.newContext({ baseURL });
      try {
        const csrfRes = await api.get("/api/auth/csrf");
        const csrfJson = (await csrfRes.json().catch(() => null)) as null | { csrfToken?: string };
        const csrfToken = typeof csrfJson?.csrfToken === "string" ? csrfJson.csrfToken : "";
        if (!csrfRes.ok() || !csrfToken) {
          const text = await csrfRes.text().catch(() => "");
          throw new Error(`load csrf failed: ${csrfRes.status()} ${text}`);
        }

        const signInRes = await api.post("/api/auth/callback/credentials?json=true", {
          form: {
            csrfToken,
            username: user,
            password: pass,
            callbackUrl: "/work",
            json: "true",
          },
        });
        if (!signInRes.ok()) {
          const text = await signInRes.text().catch(() => "");
          throw new Error(`sign in failed: ${signInRes.status()} ${text}`);
        }

        const sessionRes = await api.get("/api/auth/session");
        const sessionJson = (await sessionRes.json().catch(() => null)) as null | { user?: { username?: string } };
        if (!sessionRes.ok() || String(sessionJson?.user?.username ?? "") !== user) {
          throw new Error(`session verify failed for ${user}`);
        }

        await api.storageState({ path: out });
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= 5) break;
        await sleep(1_000 * attempt);
      } finally {
        await api.dispose();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`login failed for ${user}`);
  };

  await loginAndSave(username, password, adminOut);
  await loginAndSave(inquiryUsername, inquiryPassword, inquiryOut);
  await loginAndSave(inquiryOtherUsername, inquiryOtherPassword, inquiryOtherOut);
  await loginAndSave(inquiryAdminUsername, inquiryAdminPassword, inquiryAdminOut);
  await loginAndSave(pricingOperatorUsername, pricingOperatorPassword, operatorOut);
});
