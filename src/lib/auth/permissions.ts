import "server-only";

import { getSession } from "./server";

export type PermissionLevel = "super_admin" | "admin" | "user";

export async function requireAdminSession() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  if (session.user.permissionLevel === "user") return null;
  return session;
}

export async function requireSuperAdminSession() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  if (session.user.permissionLevel !== "super_admin") return null;
  return session;
}

