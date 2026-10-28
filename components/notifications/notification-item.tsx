import {
  AlarmClockIcon,
  BadgeCheckIcon,
  FileStackIcon,
  ListTodoIcon,
  TriangleAlertIcon,
  BellIcon,
  CalendarClockIcon,
  SirenIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClipboardListIcon,
  FileTextIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
  UserPlusIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NotificationView = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
  /** Pre-formatted time ("5 min ago"); computed where it's rendered. */
  when?: string;
};

const META: Record<string, { icon: LucideIcon; tone: string }> = {
  "submission.approved": { icon: CircleCheckIcon, tone: "bg-success/15 text-success" },
  "submission.rejected": { icon: CircleXIcon, tone: "bg-destructive/15 text-destructive" },
  "submission.reopened": { icon: RotateCcwIcon, tone: "bg-chart-2/15 text-chart-2" },
  "review.pending": { icon: ClipboardListIcon, tone: "bg-primary/10 text-primary" },
  "payout.ready": { icon: FileTextIcon, tone: "bg-primary/10 text-primary" },
  "payout.paid": { icon: BadgeCheckIcon, tone: "bg-success/15 text-success" },
  "notice.new": { icon: MegaphoneIcon, tone: "bg-chart-4/15 text-chart-4" },
  "role.assigned": { icon: UserPlusIcon, tone: "bg-chart-2/15 text-chart-2" },
  "salary.changed": { icon: WalletIcon, tone: "bg-success/15 text-success" },
  "deadline.reminder": { icon: CalendarClockIcon, tone: "bg-warning/20 text-amber-700 dark:text-warning" },
  "deadline.passed": { icon: CalendarClockIcon, tone: "bg-destructive/15 text-destructive" },
  "task.assigned": { icon: ListTodoIcon, tone: "bg-primary/10 text-primary" },
  "task.turn": { icon: FileStackIcon, tone: "bg-primary/10 text-primary" },
  "task.due": { icon: AlarmClockIcon, tone: "bg-warning/20 text-amber-700 dark:text-warning" },
  "task.overdue": { icon: TriangleAlertIcon, tone: "bg-destructive/15 text-destructive" },
  "task.escalated": { icon: SirenIcon, tone: "bg-destructive/15 text-destructive" },
  "stage.tomorrow": { icon: CalendarClockIcon, tone: "bg-primary/10 text-primary" },
  "task.done": { icon: CircleCheckIcon, tone: "bg-success/15 text-success" },
  "paper.note": { icon: MessageSquareTextIcon, tone: "bg-warning/20 text-amber-700 dark:text-warning" },
  "paper.unassigned": { icon: FileStackIcon, tone: "bg-warning/20 text-amber-700 dark:text-warning" },
};

export function relativeTime(iso: string, now: number): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Colombo" }).format(
    new Date(iso),
  );
}

/** One notification row: icon, title, message, time and an unread dot. */
export function NotificationItem({ item, compact = false }: { item: NotificationView; compact?: boolean }) {
  const meta = META[item.kind] ?? { icon: BellIcon, tone: "bg-muted text-muted-foreground" };
  const Icon = meta.icon;
  return (
    <div className={cn("flex w-full items-start gap-3 text-left", compact ? "py-0.5" : "")}>
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.tone)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", item.read ? "text-foreground/80" : "font-semibold")}>{item.title}</p>
        {item.body && (
          <p className={cn("text-muted-foreground text-xs leading-snug", compact && "line-clamp-2")}>{item.body}</p>
        )}
        {item.when && <p className="text-muted-foreground mt-0.5 text-[11px]">{item.when}</p>}
      </div>
      {!item.read && <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" />}
    </div>
  );
}
