import { WorkspaceClient } from "../../[...slug]/workspace-client";

export default async function OpsPricingPage() {
  return <WorkspaceClient workspaceKey="ops.pricing" title="核价" groupLabel="业务运营" />;
}

