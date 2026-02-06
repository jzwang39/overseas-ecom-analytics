import { MENU_GROUPS } from "@/lib/menu/config";
import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";

function findLabelByHref(href: string) {
  for (const g of MENU_GROUPS) {
    for (const it of g.items) {
      if (it.href === href) return { group: g.label, item: it.label, key: it.key };
    }
  }
  return null;
}

export default async function FinanceWarehouseCostPage() {
  const labels = findLabelByHref("/work/finance/warehouse-cost");
  const groupLabel = labels?.group ?? "财务分析";
  const title = labels?.item ?? "仓库成本";
  return (
    <ConfirmClient
      groupLabel={groupLabel}
      title={title}
      schemaUrl="/api/finance/warehouse-cost/schema"
      recordsBaseUrl="/api/finance/warehouse-cost/records"
      createId={null}
    />
  );
}
