import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";
import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function FinanceWarehouseCostPage() {
  const labels = await requireWorkspacePageAccess("/work/finance/warehouse-cost");
  return (
    <ConfirmClient
      groupLabel={labels.group}
      title={labels.item}
      schemaUrl="/api/finance/warehouse-cost/schema"
      recordsBaseUrl="/api/finance/warehouse-cost/records"
      createId={null}
    />
  );
}
