import { ConfirmClient } from "@/app/work/ops/confirm/confirm-client";
import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function FinancePenaltyAmountPage() {
  const labels = await requireWorkspacePageAccess("/work/finance/penalty-amount");
  return (
    <ConfirmClient
      groupLabel={labels.group}
      title={labels.item}
      schemaUrl="/api/finance/penalty-amount/schema"
      recordsBaseUrl="/api/finance/penalty-amount/records"
      createId={null}
    />
  );
}
