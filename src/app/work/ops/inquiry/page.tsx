import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsInquiryPage() {
  return <WorkspaceClient workspaceKey="ops.inquiry" title="询价" groupLabel="业务运营" hideCreateButton />;
}
