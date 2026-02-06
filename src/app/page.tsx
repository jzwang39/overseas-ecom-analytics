import { HomeAuthStatus } from "./home-auth-status";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14">
        <header className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">海外电商数据分析</h1>
            <p className="max-w-2xl text-sm text-muted">
              统一工作台：业务运营、财务分析、数据仪表盘与配置管理。
            </p>
          </div>
          <HomeAuthStatus />
        </header>

        <main className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-sm font-medium">业务运营</div>
            <div className="mt-2 text-sm text-muted">选品、询价、核价、确品、采购、头程物流等</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-sm font-medium">财务分析</div>
            <div className="mt-2 text-sm text-muted">销售数据、仓库成本、人员成本、ROI 等</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-sm font-medium">数据仪表盘</div>
            <div className="mt-2 text-sm text-muted">单品盈利、选品采购、运营复盘看板</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-sm font-medium">配置管理</div>
            <div className="mt-2 text-sm text-muted">用户、角色、操作日志（仅管理员可见）</div>
          </div>
        </main>
      </div>
    </div>
  );
}
