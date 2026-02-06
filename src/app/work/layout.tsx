import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getAllowedMenuKeysByRoleId } from "@/lib/menu/server";
import { filterMenuGroups } from "@/lib/menu/config";
import { AppShell } from "./app-shell";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/auth/login?callbackUrl=/work");
  }

  const allowed = await getAllowedMenuKeysByRoleId(session.user.roleId);
  const canSeeSettings = session.user.permissionLevel !== "user";
  const menuGroups = filterMenuGroups(allowed, canSeeSettings);

  return <AppShell menuGroups={menuGroups}>{children}</AppShell>;
}

