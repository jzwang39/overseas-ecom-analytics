import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { MENU_GROUPS } from "@/lib/menu/config";
import { getAllowedMenuKeysByRoleId } from "@/lib/menu/server";

export function findWorkspaceLabelByHref(href: string) {
  for (const group of MENU_GROUPS) {
    for (const item of group.items) {
      if (item.href === href) {
        return { group: group.label, item: item.label, key: item.key };
      }
    }
  }
  return null;
}

export async function requireWorkspacePageAccess(href: string) {
  const labels = findWorkspaceLabelByHref(href);
  if (!labels) {
    redirect("/work");
  }

  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(href)}`);
  }

  const allowed = await getAllowedMenuKeysByRoleId(session.user.roleId);
  if (!allowed.has(labels.key)) {
    redirect("/work");
  }

  return labels;
}
