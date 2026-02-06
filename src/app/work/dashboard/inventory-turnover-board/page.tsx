import { MENU_GROUPS } from "@/lib/menu/config";

function findLabelByHref(href: string) {
  for (const g of MENU_GROUPS) {
    for (const it of g.items) {
      if (it.href === href) return { group: g.label, item: it.label, key: it.key };
    }
  }
  return null;
}

export default async function InventoryTurnoverBoardPage() {
  const labels = findLabelByHref("/work/dashboard/inventory-turnover-board");
  const groupLabel = labels?.group ?? "数据仪表盘";
  const title = labels?.item ?? "库存周转率看板";
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="text-xs text-muted">{groupLabel}</div>
      <div className="mt-1 truncate text-lg font-semibold">{title}</div>
    </div>
  );
}
