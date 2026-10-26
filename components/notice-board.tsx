import Link from "next/link";
import { MegaphoneIcon, PinIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export type NoticeItem = {
  id: string;
  title: string;
  body: string | null;
  pinned: boolean;
  created_at: string;
  author: string | null;
};

/** Latest notices from admins (pinned first). Hidden when there are none. */
export function NoticeBoard({ notices, manageHref }: { notices: NoticeItem[]; manageHref?: string }) {
  if (notices.length === 0 && !manageHref) return null;
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MegaphoneIcon className="text-primary size-5" /> Notice board
          </CardTitle>
          <CardDescription>News and reminders from the admins</CardDescription>
        </div>
        {manageHref && (
          <Link href={manageHref} className="text-primary text-sm font-medium hover:underline">
            Manage
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {notices.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notices right now.</p>
        ) : (
          <ul className="divide-y">
            {notices.map((n) => (
              <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                <p className="flex items-center gap-1.5 font-medium">
                  {n.pinned && <PinIcon className="text-primary size-3.5 shrink-0" aria-label="Pinned" />}
                  {n.title}
                </p>
                {n.body && <p className="text-muted-foreground mt-0.5 text-sm whitespace-pre-line">{n.body}</p>}
                <p className="text-muted-foreground mt-1 text-xs">
                  {n.author ? `${n.author} · ` : ""}
                  {formatDate(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
