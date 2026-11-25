import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RenewalCardView } from "@/components/fees/renewals/renewal-card";
import { RenewalSettings } from "@/components/fees/renewals/renewal-settings";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { mainAdminUnlocked, requirePage } from "@/lib/auth";
import { dateToMonthKey, isMonthKey, todayISO } from "@/lib/core/month";
import { getRenewalsPage } from "@/lib/fees/renewals-queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Renewals" };

const ordinal = (n: number) =>
  `${n}${[11, 12, 13].includes(n % 100) ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

export default async function RenewalsPage({ searchParams }: PageProps<"/admin/fee-reminders/renewals">) {
  const { profile, canEdit } = await requirePage("fee_reminders");
  const today = todayISO();
  const param = (await searchParams).month;
  const month = typeof param === "string" && isMonthKey(param) ? param : dateToMonthKey(today);
  const supabase = await createClient();
  const data = await getRenewalsPage(supabase, month, await mainAdminUnlocked(profile));
  const { dueDay, targetPct } = data.settings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Renewals"
        description={`Last month's students who have paid this month, against the target of ${targetPct}% by the ${ordinal(dueDay)}. Students with two unanswered reminders go on the call list.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/fee-reminders">
                <ArrowLeftIcon /> Fee reminders
              </Link>
            </Button>
            {canEdit && !data.error && <RenewalSettings dueDay={dueDay} targetPct={targetPct} />}
            <MonthSelect value={month} calendar />
          </>
        }
      />

      {data.error ? (
        <EmptyState icon={AlertTriangleIcon} title="Couldn't load renewals" description={data.error} />
      ) : data.cards.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No classes in use" description="Add classes on the Classes page." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.cards.map((card) => (
            <RenewalCardView
              key={card.classId}
              card={card}
              month={month}
              today={today}
              dueDay={dueDay}
              targetPct={targetPct}
              team={data.team}
              classes={data.classes}
              canEdit={canEdit}
              showMoney={data.showMoney}
            />
          ))}
        </div>
      )}
    </div>
  );
}
