import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";
import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function SalesOpsPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/sales-ops");
  return (
    <ConfirmClient
      groupLabel={labels.group}
      title={labels.item}
      schemaUrl="/api/sales-ops/schema"
      recordsBaseUrl="/api/sales-ops/records"
      createId={null}
    />
  );
}
