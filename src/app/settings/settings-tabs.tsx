"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/settings/users", label: "用户管理" },
    { href: "/settings/roles", label: "角色管理" },
    { href: "/settings/categories", label: "类目配置" },
    { href: "/settings/logs", label: "操作日志" },
  ];

  return (
    <div className="flex gap-2">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={[
              "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm",
              active
                ? "border-border bg-surface-2 text-foreground"
                : "border-border bg-surface text-muted hover:bg-surface-2",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
