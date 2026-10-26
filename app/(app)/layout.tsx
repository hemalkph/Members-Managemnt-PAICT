import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { BirthdayCelebration } from "@/components/birthday-celebration";
import { CommandMenu } from "@/components/command-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";
import { ageOn, isBirthdayToday } from "@/lib/birthday";
import { todayISO } from "@/lib/month";
import { getBellNotifications } from "@/lib/notifications";
import { signedAvatarUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireUser();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const today = todayISO();
  const birthdayToday = isBirthdayToday(profile.date_of_birth, today);

  const [avatarUrl, pending, bell] = await Promise.all([
    signedAvatarUrl(supabase, profile.avatar_path),
    profile.is_admin
      ? supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    getBellNotifications(supabase, profile.id),
  ]);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        user={{
          name: profile.full_name || profile.email,
          email: profile.email,
          avatarUrl,
          isAdmin: profile.is_admin,
          isMainAdmin: profile.is_main_admin,
        }}
        pendingReviews={pending.count ?? 0}
      />
      <SidebarInset>
        <header className="bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="text-muted-foreground truncate text-sm">
            {profile.is_main_admin ? "Main admin" : profile.is_admin ? "Admin" : "Member"} ·{" "}
            {profile.full_name || profile.email}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <CommandMenu isAdmin={profile.is_admin} isMainAdmin={profile.is_main_admin} />
            <NotificationBell userId={profile.id} initialItems={bell.items} initialUnread={bell.unread} />
            <ThemeToggle />
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-8">{children}</div>
      </SidebarInset>
      {birthdayToday && profile.date_of_birth && (
        <BirthdayCelebration
          userId={profile.id}
          firstName={(profile.full_name || "friend").split(" ")[0]}
          age={ageOn(profile.date_of_birth, today)}
          today={today}
        />
      )}
    </SidebarProvider>
  );
}
