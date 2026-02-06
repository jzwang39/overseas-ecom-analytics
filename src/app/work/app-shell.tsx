"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useMemo, useRef, useState } from "react";
import type { MenuGroup } from "@/lib/menu/config";

function Icon({ name, className }: { name: string; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none" as const };
  switch (name) {
    case "menu":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" />
          <path strokeWidth="1.5" d="M3 12h10m0 0-3-3m3 3-3 3" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M14 6 8 12l6 6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M10 6 16 12l-6 6" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M6 10 12 16l6-6" />
        </svg>
      );
    case "chevron-up":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M6 14 12 8l6 6" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common} stroke="currentColor">
          <path
            strokeWidth="1.5"
            d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common} stroke="currentColor">
          <path
            strokeWidth="1.5"
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
          />
          <path
            strokeWidth="1.5"
            d="M19.4 15a8 8 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.4 7.4 0 0 0-1.7-1L15 5h-6l-.5 3a7.4 7.4 0 0 0-1.7 1l-2.3-.6-2 3.4 2 1.2a8 8 0 0 0 0 2l-2 1.2 2 3.4 2.3-.6a7.4 7.4 0 0 0 1.7 1l.5 3h6l.5-3a7.4 7.4 0 0 0 1.7-1l2.3.6 2-3.4-2-1.2Z"
          />
        </svg>
      );
    case "grid":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M4 19V5m0 14h16" />
          <path strokeWidth="1.5" d="M7 16v-5m4 5V8m4 8v-3m4 3V6" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common} stroke="currentColor">
          <path
            strokeWidth="1.5"
            d="M3 12V7a2 2 0 0 1 2-2h5l9 9-7 7-9-9Z"
          />
          <path strokeWidth="1.5" d="M7.5 8.5h.01" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M9 4h6v2H9V4Z" />
          <path strokeWidth="1.5" d="M7 6h10a2 2 0 0 1 2 2v13H5V8a2 2 0 0 1 2-2Z" />
          <path strokeWidth="1.5" d="M8 11h8M8 15h8" />
        </svg>
      );
    case "search":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          <path strokeWidth="1.5" d="M16.5 16.5 21 21" />
        </svg>
      );
    case "calculator":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path strokeWidth="1.5" d="M8 7h8" />
          <path strokeWidth="1.5" d="M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01" />
        </svg>
      );
    case "badge-check":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 3l2.2 2.2H17l.8 3 2.2 2.2-2.2 2.2-.8 3h-2.8L12 21l-2.2-2.2H7l-.8-3L4 13.4l2.2-2.2.8-3h2.8L12 3Z" />
          <path strokeWidth="1.5" d="m9 12 2 2 4-5" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M6 6h15l-1.5 8H7.5L6 6Z" />
          <path strokeWidth="1.5" d="M6 6 5 3H3" />
          <path strokeWidth="1.5" d="M8 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      );
    case "truck":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M3 7h11v10H3V7Z" />
          <path strokeWidth="1.5" d="M14 10h4l3 3v4h-7v-7Z" />
          <path strokeWidth="1.5" d="M6 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm13 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      );
    case "trending-up":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M3 17l6-6 4 4 7-7" />
          <path strokeWidth="1.5" d="M14 8h6v6" />
        </svg>
      );
    case "database":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z" />
          <path strokeWidth="1.5" d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path strokeWidth="1.5" d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "warehouse":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M3 10 12 4l9 6v10H3V10Z" />
          <path strokeWidth="1.5" d="M7 20v-6h10v6" />
          <path strokeWidth="1.5" d="M7 12h10" />
        </svg>
      );
    case "users":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path strokeWidth="1.5" d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path strokeWidth="1.5" d="M2.5 20a5.5 5.5 0 0 1 11 0" />
          <path strokeWidth="1.5" d="M13.5 20a4.5 4.5 0 0 1 9 0" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 3 2 20h20L12 3Z" />
          <path strokeWidth="1.5" d="M12 9v5" />
          <path strokeWidth="1.5" d="M12 17h.01" />
        </svg>
      );
    case "percent":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M19 5 5 19" />
          <path strokeWidth="1.5" d="M7.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          <path strokeWidth="1.5" d="M16.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
        </svg>
      );
    case "target":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />
          <path strokeWidth="1.5" d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" />
          <path strokeWidth="1.5" d="M12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    case "bar-chart":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M4 19V5m0 14h16" />
          <path strokeWidth="1.5" d="M7 19V11m4 8V7m4 12v-5m4 5V9" />
        </svg>
      );
    case "user":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          <path strokeWidth="1.5" d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M12 3 20 7v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4Z" />
          <path strokeWidth="1.5" d="m9 12 2 2 4-5" />
        </svg>
      );
    case "file-text":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M7 3h7l3 3v15H7V3Z" />
          <path strokeWidth="1.5" d="M14 3v4h4" />
          <path strokeWidth="1.5" d="M9 12h6M9 16h6" />
        </svg>
      );
    case "repeat":
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M4 12a8 8 0 0 1 14.6-4.4" />
          <path strokeWidth="1.5" d="M18.5 4.5V8h-3.5" />
          <path strokeWidth="1.5" d="M20 12a8 8 0 0 1-14.6 4.4" />
          <path strokeWidth="1.5" d="M5.5 19.5V16H9" />
        </svg>
      );
    default:
      return (
        <svg {...common} stroke="currentColor">
          <path strokeWidth="1.5" d="M6 12h12" />
        </svg>
      );
  }
}

export function AppShell({
  menuGroups,
  children,
}: {
  menuGroups: MenuGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(menuGroups.map((g) => [g.key, true])),
  );

  const effectiveWidth = collapsed ? 60 : sidebarWidth;
  const sidebarStyle = useMemo(
    () => ({ width: `${effectiveWidth}px` }),
    [effectiveWidth],
  );

  function onDragStart(e: React.PointerEvent) {
    if (collapsed) return;
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    const next = Math.max(220, Math.min(420, dragRef.current.startWidth + delta));
    setSidebarWidth(next);
  }

  function onDragEnd() {
    dragRef.current = null;
  }

  const sidebarContent = (
    <aside
      className="relative flex h-full flex-col border-r border-border bg-surface"
      style={sidebarStyle}
    >
      <div className="flex h-12 items-center justify-between gap-2 px-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-foreground">
            <Icon name="grid" className="h-4 w-4" />
          </div>
          {collapsed ? null : <div className="text-sm font-semibold">工作台</div>}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="hidden h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 hover:bg-surface md:inline-flex"
          title={collapsed ? "展开" : "折叠"}
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-3">
        <div className="flex flex-col gap-4 py-2">
          {menuGroups.map((group) => {
            const hasActive = group.items.some((it) => pathname === it.href || pathname.startsWith(`${it.href}/`));
            const expanded = hasActive ? true : (expandedGroups[group.key] ?? true);
            return (
              <div key={group.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  className={[
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2",
                    collapsed ? "justify-center" : "",
                  ].join(" ")}
                  title={group.label}
                  onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !(prev[group.key] ?? true) }))}
                >
                  <Icon name={group.icon} className="h-4 w-4" />
                  {collapsed ? null : <div className="min-w-0 flex-1 truncate text-left">{group.label}</div>}
                  {collapsed ? null : (
                    <Icon name={expanded ? "chevron-up" : "chevron-down"} className="h-4 w-4" />
                  )}
                </button>

                {expanded ? (
                  <div className="flex flex-col gap-1">
                    {group.items.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          className={[
                            "flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2",
                            active ? "bg-surface-2 text-foreground" : "text-muted",
                            collapsed ? "justify-center" : "",
                          ].join(" ")}
                          title={item.label}
                          onClick={() => setMobileOpen(false)}
                        >
                          <Icon name={item.icon} className="h-4 w-4" />
                          {collapsed ? null : <div className="truncate">{item.label}</div>}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3">
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2">
            <div className="text-xs">{(data?.user?.username ?? "—").slice(0, 1)}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="truncate text-sm">{data?.user?.username ?? "—"}</div>
            <div className="truncate text-xs text-muted">{data?.user?.permissionLevel ?? "—"}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 hover:bg-surface"
          title="退出"
        >
          <Icon name="logout" className="h-4 w-4" />
        </button>
      </div>

      <div
        className="absolute right-0 top-0 hidden h-full w-1 cursor-col-resize bg-transparent hover:bg-border md:block"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
    </aside>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border bg-surface px-4 md:hidden">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 hover:bg-surface"
          onClick={() => setMobileOpen((v) => !v)}
          title="菜单"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <div className="truncate text-sm font-semibold">海外电商数据分析</div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 hover:bg-surface"
          title="退出"
        >
          <Icon name="logout" className="h-5 w-5" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-3rem)] md:h-screen">
        <div className="hidden md:flex">{sidebarContent}</div>

        {mobileOpen ? (
          <div className="fixed inset-y-12 left-0 z-50 flex md:hidden">{sidebarContent}</div>
        ) : null}

        <main className="flex-1 overflow-auto">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
            <div className="hidden items-center justify-between gap-4 md:flex">
              <div className="text-sm text-muted">海外电商数据分析</div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-muted">
                  {data?.user?.username ?? "—"}（{data?.user?.permissionLevel ?? "—"}）
                </div>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2"
                  title="退出"
                >
                  <Icon name="logout" className="h-5 w-5" />
                </button>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
