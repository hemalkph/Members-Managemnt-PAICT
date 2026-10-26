import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon, ShieldCheckIcon } from "lucide-react";
import { ActivityFeed, type ActivityItem } from "@/components/activity/activity-feed";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ACTIVITY_CATEGORIES, isActivityCategory } from "@/lib/activity";
import { requireMainAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { isMonthKey, shiftMonth } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Activity log" };

const PAGE_SIZE = 40;

function relativeTime(iso: string, now: number): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return formatDateTime(iso);
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  await requireMainAdmin();
  const sp = await searchParams;
  const type = one(sp.type);
  const person = one(sp.person);
  const month = one(sp.month);
  const q = (one(sp.q) ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(500, Number.parseInt(one(sp.page) ?? "1", 10) || 1));

  const supabase = await createClient();
  let query = supabase
    .from("activity_log")
    .select("id, created_at, actor_name, action, summary, target_name, details", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (isActivityCategory(type)) {
    const filters = ACTIVITY_CATEGORIES[type].prefixes.map((p) =>
      p.endsWith(".") ? `action.like.${p}*` : `action.eq.${p}`,
    );
    query = query.or(filters.join(","));
  }
  if (person && uuid.safeParse(person).success) {
    query = query.or(`actor_id.eq.${person},target_user_id.eq.${person}`);
  }
  if (isMonthKey(month)) {
    query = query
      .gte("created_at", `${month}-01T00:00:00+05:30`)
      .lt("created_at", `${shiftMonth(month, 1)}-01T00:00:00+05:30`);
  }
  if (q) {
    query = query.ilike("summary", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  const [{ data, count }, { data: people }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);

  // eslint-disable-next-line react-hooks/purity -- request time, for "5 min ago"
  const now = Date.now();
  const items: ActivityItem[] = (data ?? []).map((row) => {
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {};
    const comment = typeof details.comment === "string" && details.comment ? details.comment : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      when: relativeTime(row.created_at, now),
      whenFull: formatDateTime(row.created_at),
      actorName: row.actor_name,
      action: row.action,
      summary: row.summary,
      targetName: row.target_name,
      comment,
    };
  });
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const value = one(v);
      if (value && k !== "page") params.set(k, value);
    }
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/admin/activity?${qs}` : "/admin/activity";
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <BlurText as="h1" text="Activity log" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">
          Who approved work, changed rates, salaries or bank details, and recorded payments.
        </p>
      </div>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Recorded automatically</AlertTitle>
        <AlertDescription>
          Entries are written by the database itself and can&apos;t be edited or deleted, even by main admins. Bank
          changes only show the last 4 digits.
        </AlertDescription>
      </Alert>

      <ActivityFilters
        people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }))}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Nothing recorded"
          description={type || person || month || q ? "Try clearing the filters." : "Changes will appear here."}
        />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {total} entr{total === 1 ? "y" : "ies"}
            {pages > 1 && (
              <>
                {" "}
                · page {page} of {pages}
              </>
            )}
          </p>
          <ActivityFeed key={`${page}-${type}-${person}-${month}-${q}`} items={items} />
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label="Pages">
              <Button asChild variant="outline" disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
                <Link href={pageHref(page - 1)} aria-disabled={page <= 1}>
                  <ChevronLeftIcon /> Newer
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className={page >= pages ? "pointer-events-none opacity-50" : ""}
              >
                <Link href={pageHref(page + 1)} aria-disabled={page >= pages}>
                  Older <ChevronRightIcon />
                </Link>
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
