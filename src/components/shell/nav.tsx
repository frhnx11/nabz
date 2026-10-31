"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: Route; label: string; exact?: boolean };

const VARIANT = {
  /** Main navigation: the active page is a solid blue pill. */
  primary: {
    base: "rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition",
    active: "bg-accent text-white shadow-sm",
    idle: "text-subtle hover:bg-line-soft hover:text-ink",
  },
  /** Section navigation (e.g. inside the ops console): a quieter white pill. */
  secondary: {
    base: "rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition",
    active: "bg-surface text-ink shadow-sm ring-1 ring-line",
    idle: "text-muted hover:text-ink",
  },
} as const;

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** A row of pill links. On narrow screens it scrolls sideways. */
export function NavPills({
  items,
  ariaLabel,
  variant = "primary",
  className = "",
}: {
  items: NavItem[];
  ariaLabel: string;
  variant?: keyof typeof VARIANT;
  className?: string;
}) {
  const pathname = usePathname();
  const v = VARIANT[variant];
  return (
    <nav
      aria-label={ariaLabel}
      className={`flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto ${className}`}
    >
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${v.base} inline-flex shrink-0 items-center gap-1.5 ${active ? v.active : v.idle}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
