import { requireWorkspacePageAccess } from "@/app/work/page-access";
import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function ConfirmPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/confirm");
  return (
    <WorkspaceClient
      workspaceKey={labels.key}
      title={labels.item}
      groupLabel={labels.group}
      hideInquiryCreateButton
      hideCreateButton
    />
  );
}
