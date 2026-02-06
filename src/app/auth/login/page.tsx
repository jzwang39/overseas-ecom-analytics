import { LoginForm } from "./login-form";
import { Suspense } from "react";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-6 py-14">
        <div className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">登录</h1>
          <div className="mt-2 text-sm text-muted">请使用管理员创建的账号密码登录。</div>
          <Suspense fallback={<div className="mt-6 text-sm text-muted">正在加载…</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
