import { requireWorkspacePageAccess } from "@/app/work/page-access";
import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsPricingPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/pricing");
  return (
    <WorkspaceClient
      workspaceKey={labels.key}
      title={labels.item}
      groupLabel={labels.group}
      hideCreateButton
      hideInquiryCreateButton
    />
  );
}
