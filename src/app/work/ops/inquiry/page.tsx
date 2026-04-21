import { requireWorkspacePageAccess } from "@/app/work/page-access";
import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsInquiryPage() {
  const labels = await requireWorkspacePageAccess("/work/ops/inquiry");
  return <WorkspaceClient workspaceKey={labels.key} title={labels.item} groupLabel={labels.group} hideCreateButton />;
}
