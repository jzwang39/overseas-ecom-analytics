import { requireWorkspacePageAccess } from "@/app/work/page-access";

export default async function InventoryTurnoverBoardPage() {
  const labels = await requireWorkspacePageAccess("/work/dashboard/inventory-turnover-board");
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="text-xs text-muted">{labels.group}</div>
      <div className="mt-1 truncate text-lg font-semibold">{labels.item}</div>
    </div>
  );
}
