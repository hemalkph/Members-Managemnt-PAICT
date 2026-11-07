// Which admin pages an account can open, and whether only to look (read only).
// Shared by the server (guards) and the browser (menus, the Edit member form).
// The database has the same rules in public.has_page().

export type PageKey =
  | "overview"
  | "analytics"
  | "payments"
  | "tasks"
  | "papers"
  | "review"
  | "members"
  | "team"
  | "reports"
  | "notices"
  | "rates"
  | "classes"
  | "structure"
  | "activity"
  | "dispatch";

export type AccessLevel = "edit" | "view" | "none";
export type PageAccessMap = Partial<Record<PageKey, AccessLevel>>;

export type PageInfo = {
  key: PageKey;
  title: string;
  href: string;
  /** Only main admins (money and the audit log). Never given to anyone else. */
  mainOnly?: boolean;
  /** Can be given to a member (not an admin). */
  forMembers?: boolean;
  /** The page has nothing to edit, so "Read only" makes no difference. */
  viewOnly?: boolean;
};

export const PAGES: PageInfo[] = [
  { key: "overview", title: "Overview", href: "/admin", viewOnly: true },
  { key: "analytics", title: "Analytics", href: "/admin/analytics", mainOnly: true },
  { key: "payments", title: "Payments", href: "/admin/payments", mainOnly: true },
  { key: "tasks", title: "Tasks", href: "/admin/tasks", forMembers: true },
  { key: "papers", title: "Papers", href: "/admin/papers", forMembers: true },
  { key: "review", title: "Work review", href: "/admin/review" },
  { key: "members", title: "Members", href: "/admin/members" },
  { key: "team", title: "Team performance", href: "/admin/team", viewOnly: true },
  { key: "reports", title: "Monthly report", href: "/admin/reports", viewOnly: true },
  { key: "notices", title: "Notice board", href: "/admin/notices", forMembers: true },
  { key: "rates", title: "Rates & budget", href: "/admin/rates", mainOnly: true },
  { key: "classes", title: "Batches & exams", href: "/admin/classes", forMembers: true },
  { key: "structure", title: "Sections & roles", href: "/admin/structure" },
  { key: "activity", title: "Activity log", href: "/admin/activity", mainOnly: true },
  { key: "dispatch", title: "Tute dispatch", href: "/admin/dispatch", forMembers: true },
];

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p])) as Record<PageKey, PageInfo>;

type AccountType = { is_admin: boolean; is_main_admin: boolean };
type Account = AccountType & { page_access?: unknown };

/** Pages whose access can be set for this kind of account (main admins: none – they have everything). */
export function editablePages(account: AccountType): PageInfo[] {
  if (account.is_main_admin) return [];
  return PAGES.filter((p) => !p.mainOnly && (account.is_admin || p.forMembers));
}

/** Default access for an account type. */
export function defaultAccess(account: AccountType, key: PageKey): AccessLevel {
  const page = PAGE_BY_KEY[key];
  if (account.is_admin && account.is_main_admin) return "edit";
  if (page.mainOnly) return "none";
  return account.is_admin ? "edit" : "none";
}

function storedMap(value: unknown): PageAccessMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PageAccessMap = {};
  for (const [k, v] of Object.entries(value)) {
    if (k in PAGE_BY_KEY && (v === "edit" || v === "view" || v === "none")) out[k as PageKey] = v;
  }
  return out;
}

/** What this account can do on a page, after its own settings. */
export function pageAccess(account: Account, key: PageKey): AccessLevel {
  const page = PAGE_BY_KEY[key];
  if (account.is_admin && account.is_main_admin) return "edit";
  if (page.mainOnly) return "none";
  if (!account.is_admin && !page.forMembers) return "none";
  return storedMap(account.page_access)[key] ?? defaultAccess(account, key);
}

/** Every page and its access level for this account. */
export function accessMap(account: Account): Record<PageKey, AccessLevel> {
  return Object.fromEntries(PAGES.map((p) => [p.key, pageAccess(account, p.key)])) as Record<PageKey, AccessLevel>;
}

/** True when the account can open at least one admin page. */
export function hasAnyPage(account: Account): boolean {
  return PAGES.some((p) => pageAccess(account, p.key) !== "none");
}

/**
 * What to save for the form's choices: null when they match the defaults for
 * the account type, otherwise only the pages that differ.
 */
export function toStoredAccess(account: AccountType, chosen: PageAccessMap): PageAccessMap | null {
  const out: PageAccessMap = {};
  for (const page of editablePages(account)) {
    const level = chosen[page.key] ?? defaultAccess(account, page.key);
    if (level !== defaultAccess(account, page.key)) out[page.key] = level;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** True when two stored values mean the same (key order doesn't matter; null = {}). */
export function sameStoredAccess(a: unknown, b: unknown): boolean {
  const x = storedMap(a);
  const y = storedMap(b);
  return PAGES.every((p) => x[p.key] === y[p.key]);
}
