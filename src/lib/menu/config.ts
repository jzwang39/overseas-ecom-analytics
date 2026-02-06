export type MenuItem = {
  key: string;
  label: string;
  href: string;
  icon:
    | "grid"
    | "folder"
    | "chart"
    | "settings"
    | "tag"
    | "clipboard"
    | "search"
    | "calculator"
    | "badge-check"
    | "cart"
    | "truck"
    | "trending-up"
    | "database"
    | "warehouse"
    | "users"
    | "alert"
    | "percent"
    | "target"
    | "bar-chart"
    | "user"
    | "shield"
    | "file-text"
    | "repeat";
};

export type MenuGroup = {
  key: string;
  label: string;
  icon: "folder" | "chart" | "grid" | "settings";
  items: MenuItem[];
};

export const MENU_GROUPS: MenuGroup[] = [
  {
    key: "ops",
    label: "业务运营",
    icon: "folder",
    items: [
      { key: "ops.purchase", label: "选品", href: "/work/ops/purchase", icon: "cart" },
      {
        key: "ops.selection_candidates",
        label: "选品备选表",
        href: "/work/ops/selection-candidates",
        icon: "tag",
      },
      { key: "ops.inquiry", label: "询价", href: "/work/ops/inquiry", icon: "search" },
      { key: "ops.pricing", label: "核价", href: "/work/ops/pricing", icon: "calculator" },
      { key: "ops.confirm", label: "确品", href: "/work/ops/confirm", icon: "badge-check" },
      { key: "ops.selection", label: "采购", href: "/work/ops/selection", icon: "clipboard" },
      {
        key: "ops.first_leg_logistics",
        label: "头程物流",
        href: "/work/ops/first-leg-logistics",
        icon: "truck",
      },
      { key: "ops.sales_ops", label: "销售运营", href: "/work/ops/sales-ops", icon: "trending-up" },
      {
        key: "ops.inventory_turnover",
        label: "库存周转",
        href: "/work/ops/inventory-turnover",
        icon: "warehouse",
      },
    ],
  },
  {
    key: "finance",
    label: "财务分析",
    icon: "chart",
    items: [
      { key: "finance.sales_data", label: "销售数据", href: "/work/finance/sales-data", icon: "bar-chart" },
      {
        key: "finance.warehouse_cost",
        label: "仓库成本",
        href: "/work/finance/warehouse-cost",
        icon: "database",
      },
      { key: "finance.staff_cost", label: "人员成本", href: "/work/finance/staff-cost", icon: "users" },
      {
        key: "finance.penalty_amount",
        label: "罚款金额",
        href: "/work/finance/penalty-amount",
        icon: "alert",
      },
      { key: "finance.roi", label: "ROI核算", href: "/work/finance/roi", icon: "percent" },
      {
        key: "finance.product_strategy",
        label: "商品策略",
        href: "/work/finance/product-strategy",
        icon: "target",
      },
      {
        key: "finance.ops_performance",
        label: "运营绩效",
        href: "/work/finance/ops-performance",
        icon: "grid",
      },
    ],
  },
  {
    key: "dashboard",
    label: "数据仪表盘",
    icon: "grid",
    items: [
      {
        key: "dashboard.sku_profit",
        label: "单品盈利看板",
        href: "/work/dashboard/sku-profit",
        icon: "chart",
      },
      {
        key: "dashboard.selection_purchase",
        label: "选品采购看板",
        href: "/work/dashboard/selection-purchase",
        icon: "folder",
      },
      {
        key: "dashboard.inventory_turnover_board",
        label: "库存周转率看板",
        href: "/work/dashboard/inventory-turnover-board",
        icon: "warehouse",
      },
      {
        key: "dashboard.ops_review",
        label: "运营复盘看板",
        href: "/work/dashboard/ops-review",
        icon: "repeat",
      },
    ],
  },
  {
    key: "settings",
    label: "配置管理",
    icon: "settings",
    items: [
      { key: "settings.users", label: "用户管理", href: "/settings/users", icon: "user" },
      { key: "settings.roles", label: "角色管理", href: "/settings/roles", icon: "shield" },
      { key: "settings.categories", label: "类目配置", href: "/settings/categories", icon: "tag" },
      { key: "settings.logs", label: "操作日志", href: "/settings/logs", icon: "file-text" },
    ],
  },
];

export function filterMenuGroups(allowedMenuKeys: Set<string>, canSeeSettings: boolean) {
  return MENU_GROUPS.map((g) => {
    const items = g.items.filter((it) => {
      if (it.key.startsWith("settings.") && !canSeeSettings) return false;
      if (it.key === "settings.categories" && canSeeSettings) return true;
      return allowedMenuKeys.has(it.key);
    });
    return { ...g, items };
  }).filter((g) => g.items.length > 0);
}
