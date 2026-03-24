import { HomeAuthStatus } from "./home-auth-status";
import Link from "next/link";
import { 
  Search, 
  Calculator, 
  ClipboardCheck, 
  Truck, 
  BarChart3, 
  RefreshCw,
  ArrowRight
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute -right-20 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
      
      <div className="absolute left-6 top-6 z-10 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
          <BarChart3 className="h-6 w-6" />
        </div>
        <span className="text-xl font-bold text-primary tracking-tight">至繁商贸</span>
      </div>

      <div className="absolute right-6 top-6 z-10">
        <HomeAuthStatus />
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-20 relative z-0">
        <header className="flex flex-col items-center text-center gap-6">
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Next-Gen E-commerce ERP
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-muted">
              让海外电商运营更简单，更高效。为您提供全链路数据分析与业务管理解决方案，从选品到库存，每一个环节都尽在掌握。
            </p>
          </div>
        </header>

        <main className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Search className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">选品管理</div>
            <p className="mt-2 text-sm text-muted">多维度筛选潜力爆款，精准把控市场趋势。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calculator className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">询价核价</div>
            <p className="mt-2 text-sm text-muted">自动计算采购成本与利润空间，优化供应链成本。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">确品采购</div>
            <p className="mt-2 text-sm text-muted">标准化确品流程，一键生成采购订单与合同。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">物流追踪</div>
            <p className="mt-2 text-sm text-muted">头程物流全程可视化，实时掌握货物动态。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">销售运营</div>
            <p className="mt-2 text-sm text-muted">深度分析销售数据，智能调整运营策略。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          <Link href="/work" className="group relative rounded-2xl border border-border bg-surface p-6 transition-all hover:shadow-lg hover:-translate-y-1">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <RefreshCw className="h-6 w-6" />
            </div>
            <div className="text-lg font-semibold">库存周转</div>
            <p className="mt-2 text-sm text-muted">精细化库存管理，提高资金利用率。</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary">
              立即进入 <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        </main>

        <footer className="mt-10 border-t border-border pt-16">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2">
              <div className="text-3xl font-bold text-primary">99.9%</div>
              <div className="text-sm text-muted">系统运行稳定性</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-3xl font-bold text-primary">100%</div>
              <div className="text-sm text-muted">数据安全保障</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-3xl font-bold text-primary">24/7</div>
              <div className="text-sm text-muted">全天候业务监控</div>
            </div>
          </div>
          <div className="mt-16 text-center text-sm text-muted">
            © 2026 至繁商贸有限公司. All rights reserved.
          </div>
        </footer>
      </div>
    </div>
  );
}
