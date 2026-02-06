import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    permissionLevel: "super_admin" | "admin" | "user";
    roleId: string | null;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      username: string;
      permissionLevel: "super_admin" | "admin" | "user";
      roleId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    username?: string;
    permissionLevel?: "super_admin" | "admin" | "user";
    roleId?: string | null;
  }
}
