"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheckIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import AnimatedList from "@/components/reactbits/animated-list";
import { Button } from "@/components/ui/button";
import { clearReadNotificationsAction, markNotificationsReadAction } from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";
import { NotificationItem, type NotificationView } from "./notification-item";

/** Full notification list (React Bits AnimatedList) with bulk actions. */
export function NotificationList({ items, unread }: { items: NotificationView[]; unread: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const readCount = items.filter((i) => i.read).length;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else if (result.message) toast.success(result.message);
      router.refresh();
    });

  const open = (item: NotificationView) =>
    startTransition(async () => {
      if (!item.read) await markNotificationsReadAction({ ids: [item.id] });
      if (item.link) router.push(item.link);
      else router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {unread > 0 ? `${unread} unread` : "All read"} · {items.length} shown
        </p>
        <div className="flex flex-wrap gap-2">
          {unread > 0 && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markNotificationsReadAction())}>
              {pending ? <Loader2Icon className="animate-spin" /> : <CheckCheckIcon />}
              Mark all as read
            </Button>
          )}
          {readCount > 0 && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(clearReadNotificationsAction)}>
              <Trash2Icon /> Clear read
            </Button>
          )}
        </div>
      </div>
      <AnimatedList
        aria-label="Notifications"
        items={items.map((item) => ({
          key: item.id,
          node: (
            <button
              type="button"
              onClick={() => open(item)}
              disabled={pending}
              className={cn(
                "bg-card hover:bg-accent/50 focus-visible:ring-ring/50 w-full rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] sm:p-4",
                !item.read && "border-primary/30 bg-primary/5",
              )}
            >
              <NotificationItem item={item} />
            </button>
          ),
        }))}
      />
    </div>
  );
}
