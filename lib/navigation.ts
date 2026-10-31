import {
  BarChart3Icon,
  BriefcaseBusinessIcon,
  CalculatorIcon,
  BanknoteIcon,
  BellIcon,
  CalendarDaysIcon,
  GaugeIcon,
  ClipboardListIcon,
  FileStackIcon,
  GraduationCapIcon,
  ListTodoIcon,
  FileTextIcon,
  HistoryIcon,
  LibraryIcon,
  ShieldCheckIcon,
  TrophyIcon,
  ClipboardCheckIcon,
  FilePlus2Icon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MegaphoneIcon,
  PieChartIcon,
  Settings2Icon,
  UserIcon,
  TruckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { AccessLevel, PageKey } from "@/lib/page-access";

export type NavItem = { title: string; href: string; icon: LucideIcon; exact?: boolean; keywords?: string };

export const MEMBER_NAV: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon, keywords: "home" },
  { title: "My week", href: "/week", icon: CalendarDaysIcon, keywords: "planner agenda schedule calendar upcoming" },
  { title: "Notifications", href: "/notifications", icon: BellIcon, keywords: "inbox messages alerts reminders" },
  { title: "My tasks", href: "/tasks", icon: ListTodoIcon, keywords: "todo assigned due papers stages" },
  { title: "Submit work", href: "/work/new", icon: FilePlus2Icon, keywords: "log add new task" },
  { title: "My work", href: "/work", icon: ListChecksIcon, keywords: "submissions history" },
  { title: "Paper library", href: "/library", icon: LibraryIcon, keywords: "final pdf download marking scheme lms physical" },
  { title: "My performance", href: "/performance", icon: GaugeIcon, keywords: "on time stats pages progress" },
  { title: "Profile", href: "/profile", icon: UserIcon, keywords: "account phone nic photo" },
  { title: "Bank details", href: "/bank", icon: LandmarkIcon, keywords: "payment account" },
  { title: "My earnings", href: "/payslips", icon: FileTextIcon, keywords: "payslips salary paid pdf payment history" },
  { title: "Two-step login", href: "/security", icon: ShieldCheckIcon, keywords: "security 2fa authenticator otp" },
];

/** Admin menu, filtered to the pages this account can open (see lib/page-access). */
export function adminNav(access: Record<PageKey, AccessLevel>): NavItem[] {
  const items: (NavItem & { page: PageKey })[] = [
    { page: "overview", title: "Overview", href: "/admin", icon: BarChart3Icon, exact: true, keywords: "admin home" },
    { page: "analytics", title: "Analytics", href: "/admin/analytics", icon: PieChartIcon, keywords: "spending money budget payouts charts" },
    { page: "payments", title: "Payments", href: "/admin/payments", icon: BanknoteIcon, keywords: "close month paid salary payslips" },
    { page: "tasks", title: "Tasks", href: "/admin/tasks", icon: ClipboardListIcon, keywords: "assign due overdue todo" },
    { page: "papers", title: "Papers", href: "/admin/papers", icon: FileStackIcon, keywords: "paper tute typeset convert mark production" },
    { page: "review", title: "Work review", href: "/admin/review", icon: ClipboardCheckIcon, keywords: "approve reject pending" },
    { page: "members", title: "Members", href: "/admin/members", icon: UsersIcon, keywords: "people team users access" },
    { page: "team", title: "Team performance", href: "/admin/team", icon: TrophyIcon, keywords: "on time late speed pages leaderboard recognition" },
    { page: "reports", title: "Monthly report", href: "/admin/reports", icon: BriefcaseBusinessIcon, keywords: "csv export" },
    { page: "notices", title: "Notice board", href: "/admin/notices", icon: MegaphoneIcon, keywords: "announcements news" },
    { page: "rates", title: "Rates & budget", href: "/admin/rates", icon: CalculatorIcon, keywords: "prices pay rate" },
    { page: "classes", title: "Batches & exams", href: "/admin/classes", icon: GraduationCapIcon, keywords: "batch exam test term centre class hall" },
    { page: "structure", title: "Sections & roles", href: "/admin/structure", icon: Settings2Icon, keywords: "teams structure" },
    { page: "dispatch", title: "Tute dispatch", href: "/admin/dispatch", icon: TruckIcon, keywords: "tutes courier citypak parcels students delivery packing" },
    { page: "activity", title: "Activity log", href: "/admin/activity", icon: HistoryIcon, keywords: "audit history who changed approved" },
  ];
  return items.filter((i) => access[i.page] !== "none");
}
