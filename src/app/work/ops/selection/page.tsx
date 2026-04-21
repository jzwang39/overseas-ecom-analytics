import { requireWorkspacePageAccess } from "@/app/work/page-access";
import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsSelectionPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/selection");
  return (
    <WorkspaceClient
      workspaceKey={labels.key}
      title={labels.item}
      groupLabel={labels.group}
      hideInquiryCreateButton
      createButtonLabel="新增选品数据"
    />
  );
}
