import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { monthKeyToDate } from "@/lib/month";
import { flattenRoles, getStructure } from "@/lib/queries";

export type ReportLine = { roleName: string; sectionName: string; count: number; quantity: number };
export type ReportMember = {
  userId: string;
  name: string;
  email: string;
  lines: ReportLine[];
  totalCount: number;
  totalQuantity: number;
};

/** Approved work per member for one month, grouped by role. */
export async function getMonthlyReport(supabase: SupabaseClient<Database>, month: string): Promise<ReportMember[]> {
  const [{ data: summary }, { data: profiles }, structure] = await Promise.all([
    supabase.from("approved_work_summary").select("*").eq("work_month", monthKeyToDate(month)),
    supabase.from("profiles").select("id, full_name, email"),
    getStructure(supabase),
  ]);

  const roles = flattenRoles(structure);
  const roleById = new Map(roles.map((r, index) => [r.id, { ...r, index }]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const byMember = new Map<string, ReportMember>();

  for (const row of summary ?? []) {
    const profile = profileById.get(row.user_id);
    const role = roleById.get(row.role_id);
    const member = byMember.get(row.user_id) ?? {
      userId: row.user_id,
      name: profile?.full_name || profile?.email || "Unknown member",
      email: profile?.email ?? "",
      lines: [],
      totalCount: 0,
      totalQuantity: 0,
    };
    member.lines.push({
      roleName: role?.name ?? "Deleted role",
      sectionName: role?.sectionName ?? "—",
      count: row.approved_count,
      quantity: row.total_quantity,
    });
    member.totalCount += row.approved_count;
    member.totalQuantity += row.total_quantity;
    byMember.set(row.user_id, member);
  }

  const order = (name: string) => roles.findIndex((r) => r.name === name);
  return [...byMember.values()]
    .map((m) => ({ ...m, lines: m.lines.sort((a, b) => order(a.roleName) - order(b.roleName)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** CSV cell: quote it, and stop spreadsheet formula injection. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
