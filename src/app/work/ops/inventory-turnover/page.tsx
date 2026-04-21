import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";
import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function InventoryTurnoverPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/inventory-turnover");
  return (
    <ConfirmClient
      groupLabel={labels.group}
      title={labels.item}
      schemaUrl="/api/inventory-turnover/schema"
      recordsBaseUrl="/api/inventory-turnover/records"
      createId={null}
    />
  );
}
