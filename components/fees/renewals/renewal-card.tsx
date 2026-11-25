import { CallList } from "@/components/fees/renewals/call-list";
import { OwnerSelect } from "@/components/fees/renewals/owner-select";
import { RenewalChart } from "@/components/fees/renewals/renewal-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLKR } from "@/lib/core/format";
import { monthLabel, shiftMonth } from "@/lib/core/month";
import type { RenewalsCard } from "@/lib/fees/renewals-queries";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";

const OUTCOME_LABEL: Record<FeeFollowupStatus, string> = {
  pending: "Not messaged",
  messaged: "Messaged",
  promised: "Promised",
  excused: "Excused",
  dropped: "Left",
  cant_afford: "Can't afford",
  moved_class: "Moved class",
};

/** One class: who renewed, who is unpaid and what they said, and who to call today. */
export function RenewalCardView({
  card,
  month,
  today,
  dueDay,
  targetPct,
  team,
  classes,
  canEdit,
  showMoney,
}: {
  card: RenewalsCard;
  month: string;
  today: string;
  dueDay: number;
  targetPct: number;
  team: { id: string; name: string; away?: string | null }[];
  classes: { id: string; name: string }[];
  canEdit: boolean;
  showMoney: boolean;
}) {
  const ownerName = team.find((p) => p.id === card.ownerId)?.name;
  const stats: { label: string; value: string }[] = [
    { label: `Paid in ${monthLabel(shiftMonth(month, -1), "short")}`, value: String(card.prevTotal) },
    {
      label: "Renewed",
      value: card.renewedPct === null ? String(card.renewed) : `${card.renewed} (${card.renewedPct}%)`,
    },
    { label: "New", value: String(card.fresh) },
    { label: "Unpaid", value: String(card.unpaid) },
  ];
  if (showMoney) {
    stats.push({ label: "At risk", value: card.moneyAtRisk === null ? "Set a fee" : formatLKR(card.moneyAtRisk) });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle>{card.className}</CardTitle>
          <CardDescription>{card.batchName}</CardDescription>
        </div>
        {canEdit ? (
          <OwnerSelect classId={card.classId} ownerId={card.ownerId} team={team} />
        ) : (
          <p className="text-muted-foreground text-sm">Calls: {ownerName ?? "anyone on Fee reminders"}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {!card.hasPrevList ? (
          <p className="text-muted-foreground text-sm">
            No paid list for {monthLabel(shiftMonth(month, -1))}, so renewals can&apos;t be counted yet.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {stats.map((s) => (
                <div key={s.label} className="rounded-lg border p-2.5">
                  <dt className="text-muted-foreground text-xs">{s.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>

            {card.unpaid > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(card.outcomes) as [FeeFollowupStatus, number][]).map(([status, n]) => (
                  <Badge key={status} variant="secondary" className="tabular-nums">
                    {OUTCOME_LABEL[status]} · {n}
                  </Badge>
                ))}
              </div>
            )}

            <RenewalChart month={month} history={card.history} dueDay={dueDay} targetPct={targetPct} />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">To call today</h3>
              <CallList
                classId={card.classId}
                month={month}
                today={today}
                calls={card.callList}
                moved={card.moved}
                classes={classes}
                canEdit={canEdit}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
