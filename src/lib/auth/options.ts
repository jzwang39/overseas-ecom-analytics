import "server-only";

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { ensureInitialSuperAdmin } from "../db/seed";
import { verifyPassword } from "../security/password";
import type { RowDataPacket } from "mysql2";
import { getPool } from "../db/pool";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    CredentialsProvider({
      name: "账号密码",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        await ensureInitialSuperAdmin();

        const input = z
          .object({
            username: z.string().min(1),
            password: z.string().min(1),
          })
          .safeParse(credentials);

        if (!input.success) return null;

        const pool = getPool();
        const [rows] = await pool.query<
          (RowDataPacket & {
            id: number;
            username: string;
            display_name: string | null;
            password_hash: string;
            permission_level: "super_admin" | "admin" | "user";
            role_id: number | null;
            is_disabled: 0 | 1;
          })[]
        >(
          "SELECT id, username, display_name, password_hash, permission_level, role_id, is_disabled FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1",
          [input.data.username],
        );

        const user = rows[0];
        if (!user) return null;
        if (user.is_disabled === 1) return null;

        const ok = await verifyPassword(input.data.password, user.password_hash);
        if (!ok) return null;

        return {
          id: String(user.id),
          name: user.display_name ?? user.username,
          username: user.username,
          permissionLevel: user.permission_level,
          roleId: user.role_id ? String(user.role_id) : null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.username = user.username;
        token.permissionLevel = user.permissionLevel;
        token.roleId = user.roleId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...(session.user ?? {}),
        id: token.userId ?? "",
        username: token.username ?? "",
        permissionLevel: token.permissionLevel ?? "user",
        roleId: token.roleId ?? null,
      };
      return session;
    },
  },
};
