"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type DispatchNavItem = { href: string; label: string };

/** Tabs inside the Tute dispatch area (keeps the main menu short). */
export function DispatchNav({ items }: { items: DispatchNavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin/dispatch" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="Tute dispatch" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b px-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground -mb-px inline-flex h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium transition-colors",
                isActive(item.href) && "border-primary text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
