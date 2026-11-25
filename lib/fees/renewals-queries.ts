import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyDbError } from "@/lib/core/action-result";
import { shiftMonth, todayISO } from "@/lib/core/month";
import {
  compareClassMonths,
  type ComparedStudent,
  type FeeComparisonResult,
  type MonthStudentRow,
} from "@/lib/fees/compare";
import { getClassComparisonData, getFeeWorkspaceBase } from "@/lib/fees/queries";
import { buildRenewalCard, findMovedClass, isClosedFollowup, type RenewalCard } from "@/lib/fees/renewals";
import type { Database } from "@/lib/supabase/database.types";
import { addDaysISO, awayBetween, shortRange } from "@/lib/team/availability";
import { getTeamDaysOff } from "@/lib/team/days-off-queries";

type Client = SupabaseClient<Database>;

/** Store today's renewal numbers and which follow-ups are still due (the rest have paid). Never throws. */
export async function recordRenewalFromResult(
  supabase: Client,
  classId: string,
  month: string,
  result: FeeComparisonResult,
): Promise<void> {
  const { error } = await supabase.rpc("fee_renewal_record", {
    p_class: classId,
    p_month: `${month}-01`,
    p_prev_total: result.summary.prevCount,
    p_renewed: result.summary.paidBothCount,
    p_new: result.summary.newCount,
    p_due_keys: result.rows.filter((r) => r.kind === "due").map((r) => r.studentKey),
  });
  if (error) console.error("fee_renewal_record failed", { classId, month, code: error.code });
}

/** Load a class's two lists, match them like Fee reminders does, and record the renewal. Never throws. */
export async function recordRenewal(
  supabase: Client,
  cls: { id: string; batchId: string },
  month: string,
): Promise<void> {
  try {
    const data = await getClassComparisonData(supabase, {
      classId: cls.id,
      batchId: cls.batchId,
      prevMonth: shiftMonth(month, -1),
      currMonth: month,
    });
    await recordRenewalFromResult(supabase, cls.id, month, compareClassMonths(data));
  } catch (err) {
    console.error("recordRenewal failed", { classId: cls.id, month, err });
  }
}

export type RenewalsCard = RenewalCard & {
  batchId: string;
  ownerId: string | null;
  /** False when last month has no paid list for this class. */
  hasPrevList: boolean;
  /** Day of month → % renewed, oldest first (snapshots, then today's live number). */
  history: { day: number; pct: number }[];
  /** Unpaid students still being chased who are on another class's list this month. */
  moved: { student: ComparedStudent; to: { classId: string; className: string } }[];
};

export type RenewalsPage = {
  month: string;
  isCurrentMonth: boolean;
  cards: RenewalsCard[];
  settings: { dueDay: number; targetPct: number };
  /** away = "away 26–28 Nov" when they have days off this week. */
  team: { id: string; name: string; away: string | null }[];
  classes: { id: string; name: string }[];
  showMoney: boolean;
  /** Set when the renewal functions aren't there yet (migration 078 not run). */
  error: string | null;
};

/** Every class in use (or with a list this month), matched against last month, with call lists. */
export async function getRenewalsPage(supabase: Client, month: string, showMoney: boolean): Promise<RenewalsPage> {
  const today = todayISO();
  const isCurrentMonth = today.slice(0, 7) === month;
  const prevMonth = shiftMonth(month, -1);

  const [
    base,
    { data: owners },
    { data: history },
    { data: settingsRows, error: settingsError },
    { data: directory },
    fees,
  ] = await Promise.all([
    getFeeWorkspaceBase(supabase),
    supabase.from("fee_classes").select("id, followup_owner_id"),
    supabase.rpc("fee_renewal_history", { p_month: `${month}-01` }),
    supabase.rpc("fee_renewal_settings"),
    supabase.rpc("team_directory"),
    showMoney ? supabase.rpc("class_fee_list") : Promise.resolve({ data: null }),
  ]);

  if (settingsError) {
    return {
      month,
      isCurrentMonth,
      cards: [],
      settings: { dueDay: 10, targetPct: 90 },
      team: [],
      classes: [],
      showMoney,
      error: friendlyDbError(settingsError),
    };
  }

  const daysOff = await getTeamDaysOff(supabase, today, addDaysISO(today, 6));
  const classes = base.classes.filter((c) => c.isActive || c.months.some((m) => m.month === month));
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o.followup_owner_id]));
  const feeById = new Map((fees.data ?? []).map((f) => [f.class_id, f.fee === null ? null : Number(f.fee)]));

  const loaded = await Promise.all(
    classes.map(async (c) => {
      const data = await getClassComparisonData(supabase, {
        classId: c.id,
        batchId: c.batchId,
        prevMonth,
        currMonth: month,
      });
      return { cls: c, data, result: compareClassMonths(data) };
    }),
  );

  const now = new Date();
  const cards: RenewalsCard[] = [];
  for (const { cls, result } of loaded) {
    const snapshots = (history ?? []).filter((h) => h.class_id === cls.id);
    const hasPrevList = cls.months.some((m) => m.month === prevMonth);
    // First time this month is opened (e.g. a list uploaded before Renewals existed): record it once.
    if (isCurrentMonth && hasPrevList && snapshots.length === 0) {
      await recordRenewalFromResult(supabase, cls.id, month, result);
    }

    const card = buildRenewalCard({
      classId: cls.id,
      className: cls.name,
      batchName: cls.batchName,
      result,
      fee: showMoney ? (feeById.get(cls.id) ?? null) : null,
      now,
      today,
    });
    if (!showMoney) card.moneyAtRisk = null;

    const points = snapshots
      .filter((s) => s.prev_total > 0)
      .map((s) => ({ day: Number(s.day.slice(8, 10)), pct: Math.round((s.renewed / s.prev_total) * 100) }));
    if (isCurrentMonth && card.renewedPct !== null) {
      const day = Number(today.slice(8, 10));
      const last = points.at(-1);
      if (last?.day === day) last.pct = card.renewedPct;
      else points.push({ day, pct: card.renewedPct });
    }

    const others = loaded
      .filter((o) => o.cls.id !== cls.id)
      .map((o) => ({ classId: o.cls.id, className: o.cls.name, students: o.data.currStudents as MonthStudentRow[] }));
    const moved = result.rows
      .filter((r) => r.kind === "due" && !isClosedFollowup(r.followupStatus))
      .map((r) => ({ student: r, to: findMovedClass(r, others) }))
      .filter((m): m is { student: ComparedStudent; to: { classId: string; className: string } } => m.to !== null);

    cards.push({
      ...card,
      batchId: cls.batchId,
      ownerId: ownerById.get(cls.id) ?? null,
      hasPrevList,
      history: points,
      moved,
    });
  }

  const settings = settingsRows?.[0];
  return {
    month,
    isCurrentMonth,
    cards,
    settings: { dueDay: settings?.due_day ?? 10, targetPct: settings?.target_pct ?? 90 },
    team: (directory ?? [])
      .filter((p) => p.is_active)
      .map((p) => {
        const away = awayBetween(daysOff, p.id, today, addDaysISO(today, 6));
        return {
          id: p.id,
          name: p.name,
          away: away.length ? `away ${away.map((d) => shortRange(d.from, d.to)).join(", ")}` : null,
        };
      }),
    classes: base.classes.map((c) => ({ id: c.id, name: c.name })),
    showMoney,
    error: settingsError ? friendlyDbError(settingsError) : null,
  };
}
