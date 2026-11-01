"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimateIcon } from "@animate-ui/react/icons";
import {
  Analytics01,
  BookOpen01,
  Coins01,
  DashboardSquare,
  Route01,
  Settings02,
  Students,
} from "@/components/animate-ui/icons/hugeicons";
import { cn } from "@/lib/utils";
import { LangToggle, useT } from "./lang";

const ICONS = {
  overview: DashboardSquare,
  rounds: Route01,
  tutes: BookOpen01,
  students: Students,
  money: Coins01,
  reports: Analytics01,
  settings: Settings02,
} as const;

export type DispatchNavItem = { href: string; label: string; icon: keyof typeof ICONS };

/** Tabs inside the Tute dispatch area (keeps the main menu short). */
export function DispatchNav({ items }: { items: DispatchNavItem[] }) {
  const pathname = usePathname();
  const t = useT();
  const isActive = (href: string) =>
    href === "/admin/dispatch" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="flex items-end gap-2 border-b print:hidden">
      <nav aria-label={t("Tute dispatch")} className="-mx-1 min-w-0 flex-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.href}>
                <AnimateIcon animateOnHover asChild>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cn(
                      "text-muted-foreground hover:text-foreground -mb-px inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium transition-colors",
                      isActive(item.href) && "border-primary text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {t(item.label)}
                  </Link>
                </AnimateIcon>
              </li>
            );
          })}
        </ul>
      </nav>
      <LangToggle className="mb-1.5" />
    </div>
  );
}
