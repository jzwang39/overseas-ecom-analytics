import { MENU_GROUPS } from "@/lib/menu/config";
import { WorkspaceClient } from "./workspace-client";

function findLabelByHref(href: string) {
  for (const g of MENU_GROUPS) {
    for (const it of g.items) {
      if (it.href === href) return { group: g.label, item: it.label, key: it.key };
    }
  }
  return null;
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug?: string[] | string }>;
}) {
  const { slug: raw } = await params;
  const slug = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const href = `/work/${slug.join("/")}`;
  const labels = findLabelByHref(href);

  if (slug.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">工作区</div>
        <div className="mt-2 text-sm text-muted">无效路径</div>
      </div>
    );
  }

  if (!labels) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-sm font-medium">工作区</div>
        <div className="mt-2 text-sm text-muted">未找到对应菜单：{href}</div>
      </div>
    );
  }

  return (
    <WorkspaceClient workspaceKey={labels.key} title={labels.item} groupLabel={labels.group} />
  );
}
