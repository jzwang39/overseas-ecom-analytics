import { MENU_GROUPS } from "@/lib/menu/config";
import { WorkspaceClient } from "../../[...slug]/workspace-client";

function findLabelByHref(href: string) {
  for (const g of MENU_GROUPS) {
    for (const it of g.items) {
      if (it.href === href) return { group: g.label, item: it.label, key: it.key };
    }
  }
  return null;
}

export default async function ConfirmPage() {
  const labels = findLabelByHref("/work/ops/confirm");
  const groupLabel = labels?.group ?? "业务运营";
  const title = labels?.item ?? "确品";
  return (
    <WorkspaceClient
      workspaceKey="ops.confirm"
      title={title}
      groupLabel={groupLabel}
      hideInquiryCreateButton
      hideCreateButton
    />
  );
}
