"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRightIcon, ChevronsUpDownIcon, LandmarkIcon, LogOutIcon, UserIcon } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import ShinyText from "@/components/reactbits/shiny-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { initials } from "@/lib/format";
import { adminNav as getAdminNav, MEMBER_NAV, type NavItem as BaseNavItem } from "@/lib/navigation";
import type { AccessLevel, PageKey } from "@/lib/page-access";

type NavItem = BaseNavItem & { badge?: number };

export type SidebarUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** Admin pages this account can open. */
  pages: Record<PageKey, AccessLevel>;
  /** Can open the Citypak integration module (dispatch access + Courier or Plan). */
  citypak?: boolean;
};

const inSection = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * A menu item with sub-pages (e.g. Citypak integration → Bulk uploads): a
 * collapsible group with a chevron, its sub-pages indented with a thin line.
 * It opens by itself whenever the current page is inside the section, and
 * otherwise keeps the open/closed state the person chose while they navigate.
 */
function CollapsibleNavItem({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const { state, isMobile } = useSidebar();
  const inside = inSection(pathname, item.href);
  const [open, setOpen] = useState(inside);
  // Entering the section (any link, or a direct visit to a sub-page) opens it.
  const [wasInside, setWasInside] = useState(inside);
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }
  const children = item.children ?? [];

  // Icon-only sidebar: sub-menus can't show, so the item goes to the first sub-page.
  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={inside} tooltip={item.title}>
          <Link href={children[0]?.href ?? item.href} onClick={onNavigate}>
            <item.icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          {/* Highlighted while closed if the current page is inside, so it's never lost. */}
          <SidebarMenuButton tooltip={item.title} isActive={inside && !open}>
            <item.icon />
            <span>{item.title}</span>
            <ChevronRightIcon
              aria-hidden
              className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden motion-reduce:animate-none">
          <SidebarMenuSub>
            {children.map((child) => {
              const active = inSection(pathname, child.href);
              return (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton asChild isActive={active}>
                    <Link href={child.href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
                      <span>{child.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar({ user, pendingReviews }: { user: SidebarUser; pendingReviews: number }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const adminNav: NavItem[] = getAdminNav(user.pages, { citypak: user.citypak }).map((item) =>
    item.href === "/admin/review" ? { ...item, badge: pendingReviews } : item,
  );

  const isActive = (item: NavItem) => {
    // "/work/new" has its own item, so "My work" only matches the list and edit pages.
    if (item.href === "/work") return pathname === "/work" || /^\/work\/[^/]+\/edit$/.test(pathname);
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const renderGroup = (label: string, items: NavItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) =>
            item.children?.length ? (
              <CollapsibleNavItem key={item.href} item={item} pathname={pathname} onNavigate={() => setOpenMobile(false)} />
            ) : (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.title}>
                <Link href={item.href} onClick={() => setOpenMobile(false)}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.badge ? <SidebarMenuBadge>{item.badge > 99 ? "99+" : item.badge}</SidebarMenuBadge> : null}
            </SidebarMenuItem>
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={user.pages.overview !== "none" ? "/admin" : "/dashboard"} onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <BrandLogo className="h-auto w-8" priority />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <ShinyText text="Team Work Tracker" className="truncate font-semibold" />
                  <span className="text-muted-foreground truncate text-xs">A/L ICT class team</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {adminNav.length > 0 && renderGroup("Admin", adminNav)}
        {renderGroup(adminNav.length > 0 ? "My space" : "Menu", MEMBER_NAV)}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                    <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" side="top" align="end">
                <DropdownMenuLabel className="font-normal">
                  <div className="grid text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {user.isAdmin ? "Admin" : "Member"} · {user.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" onClick={() => setOpenMobile(false)}>
                    <UserIcon /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/bank" onClick={() => setOpenMobile(false)}>
                    <LandmarkIcon /> Bank details
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action="/auth/signout" method="post">
                  <DropdownMenuItem asChild variant="destructive">
                    <button type="submit" className="w-full">
                      <LogOutIcon /> Log out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
