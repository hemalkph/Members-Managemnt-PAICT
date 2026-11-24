import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dateToMonthKey, monthKeyToDate, shiftMonth } from "@/lib/core/month";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ClassRow = Database["public"]["Functions"]["class_ops_overview"]["Returns"][number];
export type PlannedTute = { id: string; classId: string; month: string; tuteId: string; name: string; code: string };
export type ShelfTute = { id: string; name: string; code: string };

/** Everything the Classes page shows: classes with counts, the shelf, and 3 months of tute plan. */
export async function getClassOps(supabase: Client, month: string) {
  const months = [month, shiftMonth(month, 1), shiftMonth(month, 2)];
  const [overview, batches, tutes, plan] = await Promise.all([
    supabase.rpc("class_ops_overview", { p_month: monthKeyToDate(month) }),
    supabase.from("batches").select("id, name, is_active, sort_order").order("sort_order").order("name"),
    supabase.from("class_tutes").select("id, name, code").eq("is_active", true).order("name"),
    supabase
      .from("class_month_tutes")
      .select("id, class_id, month, tute_id, sort_order, class_tutes(name, code)")
      .in("month", months.map(monthKeyToDate))
      .order("sort_order"),
  ]);
  if (overview.error) throw new Error(overview.error.message);

  return {
    months,
    classes: overview.data ?? [],
    batches: (batches.data ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active })),
    tutes: (tutes.data ?? []) as ShelfTute[],
    plan: (plan.data ?? []).map(
      (p): PlannedTute => ({
        id: p.id,
        classId: p.class_id,
        month: dateToMonthKey(p.month),
        tuteId: p.tute_id,
        name: p.class_tutes?.name ?? "?",
        code: p.class_tutes?.code ?? "",
      }),
    ),
  };
}
