import type { Metadata } from "next";
import Link from "next/link";
import { BellIcon } from "lucide-react";
import { relativeTime } from "@/components/notifications/notification-item";
import { NotificationList } from "@/components/notifications/notification-list";
import { EmptyState } from "@/components/empty-state";
import { PhoneAlertsCard } from "@/components/pwa/phone-alerts-card";
import BlurText from "@/components/reactbits/blur-text";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const profile = await requireUser();
  const onlyUnread = (await searchParams).show === "unread";
  const supabase = await createClient();

  let query = supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (onlyUnread) query = query.is("read_at", null);

  const [{ data }, { count }, { count: devices }] = await Promise.all([
    query,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .is("read_at", null),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
  ]);

  // eslint-disable-next-line react-hooks/purity -- request time, for "5 min ago"
  const now = Date.now();
  const items = (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    createdAt: n.created_at,
    read: n.read_at !== null,
    when: relativeTime(n.created_at, now),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Notifications" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">Reviews, payments, notices and deadline reminders.</p>
        </div>
        <Tabs value={onlyUnread ? "unread" : "all"}>
          <TabsList>
            <TabsTrigger value="all" asChild>
              <Link href="/notifications">All</Link>
            </TabsTrigger>
            <TabsTrigger value="unread" asChild>
              <Link href="/notifications?show=unread">Unread{count ? ` (${count})` : ""}</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <PhoneAlertsCard vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} devices={devices ?? 0} />

      {items.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title={onlyUnread ? "No unread notifications" : "No notifications yet"}
          description="You'll see reviews of your work, payments, notices and deadline reminders here."
        />
      ) : (
        <NotificationList key={`${onlyUnread}-${items.length}-${count}`} items={items} unread={count ?? 0} />
      )}
    </div>
  );
}
