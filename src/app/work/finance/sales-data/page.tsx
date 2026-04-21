import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";
import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function FinanceSalesDataPage() {
  const labels = await requireWorkspacePageAccess("/work/finance/sales-data");
  return (
    <ConfirmClient
      groupLabel={labels.group}
      title={labels.item}
      schemaUrl="/api/finance/sales-data/schema"
      recordsBaseUrl="/api/finance/sales-data/records"
      createId={null}
    />
  );
}
