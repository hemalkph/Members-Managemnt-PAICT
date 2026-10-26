import {
  BarChart3Icon,
  BriefcaseBusinessIcon,
  CalculatorIcon,
  ClipboardCheckIcon,
  FilePlus2Icon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MegaphoneIcon,
  PieChartIcon,
  Settings2Icon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { title: string; href: string; icon: LucideIcon; exact?: boolean; keywords?: string };

export const MEMBER_NAV: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon, keywords: "home" },
  { title: "Submit work", href: "/work/new", icon: FilePlus2Icon, keywords: "log add new task" },
  { title: "My work", href: "/work", icon: ListChecksIcon, keywords: "submissions history" },
  { title: "Profile", href: "/profile", icon: UserIcon, keywords: "account phone nic photo" },
  { title: "Bank details", href: "/bank", icon: LandmarkIcon, keywords: "payment account" },
];

/** Admin menu. Items marked mainOnly are only for main admins. */
export function adminNav(isMainAdmin: boolean): NavItem[] {
  const items: (NavItem & { mainOnly?: boolean })[] = [
    { title: "Overview", href: "/admin", icon: BarChart3Icon, exact: true, keywords: "admin home" },
    {
      title: "Analytics",
      href: "/admin/analytics",
      icon: PieChartIcon,
      mainOnly: true,
      keywords: "spending money budget payouts charts",
    },
    { title: "Work review", href: "/admin/review", icon: ClipboardCheckIcon, keywords: "approve reject pending" },
    { title: "Members", href: "/admin/members", icon: UsersIcon, keywords: "people team users" },
    { title: "Monthly report", href: "/admin/reports", icon: BriefcaseBusinessIcon, keywords: "csv export" },
    { title: "Notice board", href: "/admin/notices", icon: MegaphoneIcon, keywords: "announcements news" },
    {
      title: "Rates & budget",
      href: "/admin/rates",
      icon: CalculatorIcon,
      mainOnly: true,
      keywords: "prices pay rate",
    },
    { title: "Sections & roles", href: "/admin/structure", icon: Settings2Icon, keywords: "teams structure" },
  ];
  return items.filter((i) => isMainAdmin || !i.mainOnly);
}
