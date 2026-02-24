import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsPurchasePage() {
  return (
    <WorkspaceClient
      workspaceKey="ops.purchase"
      title="选品"
      groupLabel="业务运营"
      hideInquiryCreateButton
      createButtonLabel="新增选品数据"
    />
  );
}
