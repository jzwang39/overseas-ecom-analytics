import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsPurchasePage() {
  return (
    <WorkspaceClient
      workspaceKey="ops.purchase"
      title="采购"
      groupLabel="业务运营"
      hideInquiryCreateButton
      hideCreateButton
    />
  );
}
