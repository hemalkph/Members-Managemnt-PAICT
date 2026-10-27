import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PaperStageName } from "@/lib/database.types";
import type { DraftItem } from "@/components/member/paper-drafts-card";
import { formatDate } from "@/lib/format";
import { PAID_PAGE_STAGES, STAGE_LABEL } from "@/lib/papers";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";

type Client = SupabaseClient<Database>;

export type PaperRate = { roleId: string; roleName: string; rateItemId: string; rateName: string; price: number };

export type PaperDraft = {
  taskId: string;
  title: string;
  stage: PaperStageName;
  stageLabel: string;
  paperId: string;
  paperTitle: string;
  examId: string | null;
  completedAt: string | null;
  link: string | null;
  /** Role and page rate it will be logged under (null = choose in the full form). */
  rate: PaperRate | null;
};

type RoleWithRates = { id: string; name: string; rates: { id: string; name: string; unit: string; price: number }[] };

/**
 * Which of the member's roles and page rates a paper stage is paid with:
 * type setting → a "Type set…" role's page rate; conversion → the translation
 * page rate for papers or tutes.
 */
export function pickPaperRate(stage: PaperStageName, kind: "paper" | "tute", roles: RoleWithRates[]): PaperRate | null {
  const pageRates = roles.flatMap((r) =>
    r.rates.filter((x) => /page/i.test(x.unit)).map((x) => ({ role: r, rate: x })),
  );
  let pick: (typeof pageRates)[number] | undefined;
  if (stage === "convert") {
    const converting = pageRates.filter(
      ({ role, rate }) => /conver|translat/i.test(role.name) || /conver|translat/i.test(rate.name),
    );
    pick =
      converting.find(({ rate }) => (kind === "tute" ? /tute/i : /paper/i).test(rate.name)) ??
      converting.find(({ rate }) => !/marking|tute|paper/i.test(rate.name)) ??
      converting[0];
  } else {
    const typing = pageRates.filter(({ role, rate }) => /type\s*-?\s*set/i.test(role.name) || /type\s*-?\s*set/i.test(rate.name));
    pick = typing[0];
  }
  return pick
    ? { roleId: pick.role.id, roleName: pick.role.name, rateItemId: pick.rate.id, rateName: pick.rate.name, price: pick.rate.price }
    : null;
}

type TaskRow = {
  id: string;
  title: string;
  exam_id: string | null;
  completed_at: string | null;
  stage: { stage: PaperStageName; link: string | null; paper: { id: string; title: string; kind: "paper" | "tute" } | null } | null;
  submissions: { count: number }[];
};

/** Finished type setting / conversion stages the member hasn't logged as work yet. */
export async function getPaperDrafts(supabase: Client, userId: string, onlyTaskId?: string): Promise<PaperDraft[]> {
  let query = supabase
    .from("tasks")
    .select("id, title, exam_id, completed_at, stage:paper_stages(stage, link, paper:papers(id, title, kind)), submissions(count)")
    .eq("assignee_id", userId)
    .eq("status", "done")
    .not("paper_stage_id", "is", null)
    .order("completed_at", { ascending: false })
    .limit(50);
  if (onlyTaskId) query = query.eq("id", onlyTaskId);
  const { data } = await query;
  const rows = ((data ?? []) as unknown as TaskRow[]).filter(
    (t) => t.stage?.paper && PAID_PAGE_STAGES.includes(t.stage.stage) && (t.submissions?.[0]?.count ?? 0) === 0,
  );
  if (rows.length === 0) return [];

  const roles = await getMemberRoles(supabase, userId);
  const rates = await getRatesForRoles(
    supabase,
    roles.map((r) => r.id),
  );
  const withRates: RoleWithRates[] = roles.map((r) => ({ id: r.id, name: r.name, rates: rates.get(r.id) ?? [] }));

  return rows.map((t) => ({
    taskId: t.id,
    title: t.title,
    stage: t.stage!.stage,
    stageLabel: STAGE_LABEL[t.stage!.stage],
    paperId: t.stage!.paper!.id,
    paperTitle: t.stage!.paper!.title,
    examId: t.exam_id,
    completedAt: t.completed_at,
    link: t.stage!.link,
    rate: pickPaperRate(t.stage!.stage, t.stage!.paper!.kind, withRates),
  }));
}

/** For the "Ready to log" card. */
export function toDraftItems(drafts: PaperDraft[]): DraftItem[] {
  return drafts.map((d) => ({
    taskId: d.taskId,
    title: d.title,
    stageLabel: d.stageLabel,
    doneOn: d.completedAt ? formatDate(d.completedAt) : null,
    rateLabel: d.rate ? `${d.rate.rateName} (${d.rate.roleName})` : null,
    price: d.rate?.price ?? null,
  }));
}
