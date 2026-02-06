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

export default async function PurchasePage() {
  const labels = findLabelByHref("/work/ops/selection");
  const groupLabel = labels?.group ?? "业务运营";
  const title = labels?.item ?? "采购";
  return <ConfirmClient groupLabel={groupLabel} title={title} />;
}
