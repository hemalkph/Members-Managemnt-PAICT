import type { Metadata } from "next";
import { NoticesManager } from "@/components/admin/notices-manager";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { requirePage } from "@/lib/auth";
import { todayISO } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notice board" };

export default async function NoticesPage() {
  const { canEdit } = await requirePage("notices");
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, expires_on, created_at, author:profiles!announcements_created_by_fkey(full_name)")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  const today = todayISO();

  return (
    <div className="space-y-6">
      <PageHeader title="Notice board" description="Post reminders and news. Members see current notices on their dashboard." />
      {!canEdit && <ReadOnlyNotice />}
      <NoticesManager
        readOnly={!canEdit}
        notices={(data ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          pinned: n.pinned,
          expires_on: n.expires_on,
          created_at: n.created_at,
          author: n.author?.full_name ?? null,
          expired: Boolean(n.expires_on && n.expires_on < today),
        }))}
      />
    </div>
  );
}
