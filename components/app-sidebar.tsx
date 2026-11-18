"use client";

import { HoverPrefetchLink } from "@/components/hover-prefetch-link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRightIcon, ChevronsUpDownIcon, LandmarkIcon, LogOutIcon, UserIcon } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import ShinyText from "@/components/reactbits/shiny-text";
import { unsubscribePushEndpoint } from "@/lib/auth/client-signout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { initials } from "@/lib/core/format";
import { cn } from "@/lib/utils";
import {
  adminNav as getAdminNav,
  MEMBER_NAV,
  NAV_FOLDERS,
  type NavFolder,
  type NavItem as BaseNavItem,
} from "@/lib/auth/navigation";
import type { AccessLevel, PageKey } from "@/lib/auth/page-access";

type NavItem = BaseNavItem & { badge?: number };
type Entry = { kind: "item"; item: NavItem } | { kind: "folder"; name: NavFolder; items: NavItem[] };

const SECTION_ORDER = ["Overview", "Work", "Team", "Manage", "My space"];

/** Items → sections (in SECTION_ORDER), related items gathered into their fold-out. */
function toSections(items: NavItem[]) {
  const sections = new Map<string, Entry[]>();
  for (const item of items) {
    const section = item.section ?? "Menu";
    const entries = sections.get(section) ?? [];
    sections.set(section, entries);
    const folder = item.folder && entries.find((e) => e.kind === "folder" && e.name === item.folder);
    if (folder && folder.kind === "folder") folder.items.push(item);
    else if (item.folder) entries.push({ kind: "folder", name: item.folder, items: [item] });
    else entries.push({ kind: "item", item });
  }
  // A fold-out with one page left (page access) is just that page.
  const flat = (entries: Entry[]): Entry[] =>
    entries.map((e) => (e.kind === "folder" && e.items.length === 1 ? { kind: "item", item: e.items[0] } : e));
  const rank = (s: string) => (SECTION_ORDER.includes(s) ? SECTION_ORDER.indexOf(s) : SECTION_ORDER.length);
  return [...sections]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([label, entries]) => ({ label, entries: flat(entries) }));
}

export type SidebarUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** Admin pages this account can open. */
  pages: Record<PageKey, AccessLevel>;
};

export function AppSidebar({ user, pendingReviews }: { user: SidebarUser; pendingReviews: number }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const adminNav: NavItem[] = getAdminNav(user.pages).map((item) =>
    item.href === "/admin/review" ? { ...item, badge: pendingReviews } : item,
  );

  const isActive = (item: NavItem) => {
    // "/work/new" has its own item, so "My work" only matches the list and edit pages.
    if (item.href === "/work") return pathname === "/work" || /^\/work\/[^/]+\/edit$/.test(pathname);
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const link = (item: NavItem, sub = false) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton asChild isActive={isActive(item)} tooltip={sub ? undefined : item.title}>
        <HoverPrefetchLink href={item.href} onClick={() => setOpenMobile(false)}>
          {!sub && <item.icon />}
          <span>{item.title}</span>
        </HoverPrefetchLink>
      </SidebarMenuButton>
      {item.badge ? <SidebarMenuBadge>{item.badge > 99 ? "99+" : item.badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );

  const sections = toSections([...adminNav, ...MEMBER_NAV]);

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <HoverPrefetchLink
                href={user.pages.overview !== "none" ? "/admin" : "/dashboard"}
                onClick={() => setOpenMobile(false)}
              >
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <BrandLogo className="h-auto w-8" priority />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <ShinyText text="Team WorkSpace PAICT" className="truncate font-semibold" />
                  <span className="text-muted-foreground truncate text-xs">A/L ICT class team</span>
                </div>
              </HoverPrefetchLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map(({ label, entries }) => (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {entries.map((e) =>
                  e.kind === "item" ? (
                    link(e.item)
                  ) : (
                    <NavFolderItem
                      key={e.name}
                      name={e.name}
                      active={e.items.some(isActive)}
                      badge={e.items.reduce((n, i) => n + (i.badge ?? 0), 0)}
                    >
                      {e.items.map((i) => link(i, true))}
                    </NavFolderItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
                  <HoverPrefetchLink href="/profile" onClick={() => setOpenMobile(false)}>
                    <UserIcon /> Profile
                  </HoverPrefetchLink>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <HoverPrefetchLink href="/bank" onClick={() => setOpenMobile(false)}>
                    <LandmarkIcon /> Bank details
                  </HoverPrefetchLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action="/auth/signout" method="post" onSubmit={signOutWithAlerts}>
                  <input type="hidden" name="endpoint" />
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

/** A fold-out of related pages. Opens by itself when one of its pages is open. */
function NavFolderItem({
  name,
  active,
  badge,
  children,
}: {
  name: NavFolder;
  active: boolean;
  badge: number;
  children: React.ReactNode;
}) {
  const { state, setOpen: setSidebarOpen } = useSidebar();
  const [open, setOpen] = useState(active);
  // Opening one of its pages from elsewhere (search, a link) opens the fold-out too.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }
  const Icon = NAV_FOLDERS[name];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={name}
        aria-expanded={open}
        isActive={active && state === "collapsed"}
        onClick={() => {
          // Icon-only sidebar: widen it and show the pages.
          if (state === "collapsed") {
            setSidebarOpen(true);
            setOpen(true);
          } else setOpen(!open);
        }}
      >
        <Icon />
        <span>{name}</span>
        <ChevronRightIcon className={cn("ml-auto transition-transform duration-200", open && "rotate-90")} />
      </SidebarMenuButton>
      {!open && badge > 0 ? (
        <SidebarMenuBadge className="right-7">{badge > 99 ? "99+" : badge}</SidebarMenuBadge>
      ) : null}
      {open && (
        <ul className="border-sidebar-border mx-3.5 mt-1 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5 group-data-[collapsible=icon]:hidden">
          {children}
        </ul>
      )}
    </SidebarMenuItem>
  );
}

/**
 * Before logging out, switch this phone's alerts off and tell the server which
 * phone it was, so the next person on this device doesn't get them.
 */
function signOutWithAlerts(event: React.FormEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  if (form.dataset.ready) return; // second pass: let the browser submit
  event.preventDefault();
  void unsubscribePushEndpoint().then((endpoint) => {
    if (endpoint) {
      (form.elements.namedItem("endpoint") as HTMLInputElement).value = endpoint;
    }
    form.dataset.ready = "1";
    form.requestSubmit();
  });
}
