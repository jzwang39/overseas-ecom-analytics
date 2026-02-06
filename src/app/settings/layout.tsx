import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getAllowedMenuKeysByRoleId } from "@/lib/menu/server";
import { filterMenuGroups } from "@/lib/menu/config";
import { AppShell } from "@/app/work/app-shell";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/auth/login?callbackUrl=/settings/users");
  }

  if (session.user.permissionLevel === "user") {
    redirect("/work");
  }

  const allowed = await getAllowedMenuKeysByRoleId(session.user.roleId);
  const menuGroups = filterMenuGroups(allowed, true);

  return <AppShell menuGroups={menuGroups}>{children}</AppShell>;
}

