"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { markNotificationsReadAction } from "@/lib/actions/notifications";
import type { AppNotification } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { NotificationItem, relativeTime, type NotificationView } from "./notification-item";

const MAX_ITEMS = 15;

export function toNotificationView(n: Pick<AppNotification, "id" | "kind" | "title" | "body" | "link" | "created_at" | "read_at">): NotificationView {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    createdAt: n.created_at,
    read: n.read_at !== null,
  };
}

/** Bell in the top bar: unread count, latest notifications, live updates. */
export function NotificationBell({
  userId,
  initialItems,
  initialUnread,
}: {
  userId: string;
  initialItems: NotificationView[];
  initialUnread: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const [, startTransition] = useTransition();

  // Live updates (Supabase Realtime; only your own rows are delivered).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = toNotificationView(payload.new as AppNotification);
          setItems((prev) => [n, ...prev.filter((i) => i.id !== n.id)].slice(0, MAX_ITEMS));
          if (!n.read) setUnread((u) => u + 1);
          toast(n.title, {
            description: n.body ?? undefined,
            action: n.link ? { label: "View", onClick: () => router.push(n.link!) } : undefined,
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = toNotificationView(payload.new as AppNotification);
          // Grouped messages (e.g. "3 submissions waiting") move back to the top.
          setItems((prev) =>
            n.read ? prev.map((i) => (i.id === n.id ? n : i)) : [n, ...prev.filter((i) => i.id !== n.id)].slice(0, MAX_ITEMS),
          );
          // Read in another tab: recount.
          void supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .is("read_at", null)
            .then(({ count }) => {
              if (typeof count === "number") setUnread(count);
            });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  const markAll = () => {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
    startTransition(async () => {
      const result = await markNotificationsReadAction();
      if (!result.ok) toast.error(result.error);
    });
  };

  const openItem = (item: NotificationView) => {
    if (!item.read) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
      startTransition(async () => {
        await markNotificationsReadAction({ ids: [item.id] });
      });
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setNow(Date.now());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <BellIcon />
          {unread > 0 && (
            <motion.span
              key={unread}
              // Same first render on server and client; instant with reduced motion.
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 20 }}
              className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll}>
              <CheckCheckIcon /> Mark all as read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="text-muted-foreground px-4 py-10 text-center text-sm">
            <BellIcon className="mx-auto mb-2 size-6 opacity-50" />
            You&apos;re all caught up.
          </div>
        ) : (
          <ul className="max-h-[min(24rem,60vh)] overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "hover:bg-accent focus-visible:bg-accent w-full px-4 py-2.5 outline-none",
                    !item.read && "bg-primary/5",
                  )}
                >
                  <NotificationItem item={{ ...item, when: relativeTime(item.createdAt, now) }} compact />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
