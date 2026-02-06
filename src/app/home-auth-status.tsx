"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export function HomeAuthStatus() {
  const { data, status } = useSession();

  if (status === "loading") {
    return <div className="text-sm text-muted">正在加载登录状态…</div>;
  }

  if (!data?.user?.id) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/auth/login"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2"
        >
          登录
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-muted">
        已登录：{data.user.username}（{data.user.permissionLevel}）
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm hover:bg-surface-2"
      >
        退出
      </button>
      <Link
        href="/work"
        className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2"
      >
        进入工作台
      </Link>
    </div>
  );
}

