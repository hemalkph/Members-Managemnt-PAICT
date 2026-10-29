import { BirthdayBanner } from "@/components/admin/birthday-banner";
import { requireAnyPage } from "@/lib/auth";
import { getBirthdays } from "@/lib/birthday-queries";
import { todayISO } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireAnyPage();
  const supabase = await createClient();
  // Birthdays need every profile, so only admins see the banner.
  const todays = profile.is_admin
    ? (await getBirthdays(supabase, todayISO(), 0)).filter((p) => p.daysUntil === 0)
    : [];

  return (
    <>
      <BirthdayBanner people={todays} />
      {children}
    </>
  );
}
