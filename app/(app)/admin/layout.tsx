import { BirthdayBanner } from "@/components/admin/birthday-banner";
import { requireAdmin } from "@/lib/auth";
import { getBirthdays } from "@/lib/birthday-queries";
import { todayISO } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  const supabase = await createClient();
  const todays = (await getBirthdays(supabase, todayISO(), 0)).filter((p) => p.daysUntil === 0);

  return (
    <>
      <BirthdayBanner people={todays} />
      {children}
    </>
  );
}
