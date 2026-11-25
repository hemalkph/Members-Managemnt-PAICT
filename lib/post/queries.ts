import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyToDate } from "@/lib/core/month";
import type { Database, PostParcelStatus, PostRoundStatus } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type PostStudent = {
  studentKey: string;
  name: string;
  classes: string;
  whatsapp: string | null;
  address: string | null;
  checked: boolean;
  problem: string;
  tutesDue: number;
  tutesSent: number;
};

export type PostList = {
  classId: string;
  className: string;
  isActive: boolean;
  fileName: string | null;
  uploadedAt: string | null;
  students: number;
  withAddress: number;
};

export type PostRoundSummary = {
  id: string;
  kind: "main" | "top_up";
  status: PostRoundStatus;
  createdAt: string;
  handedOverAt: string | null;
  receiptTotal: number | null;
  parcels: number;
  packed: number;
  tracked: number;
};

export type PostParcel = {
  id: string;
  number: number;
  name: string;
  whatsapp: string | null;
  address: string;
  district: string;
  trackingNo: string | null;
  status: PostParcelStatus;
  waSentAt: string | null;
  tutes: string[];
};

export type PostRound = PostRoundSummary & { batchId: string; month: string; parcelList: PostParcel[] };

/** Students on the month's Speed Post lists, each class's list, and that month's rounds. */
export async function getPostMonth(supabase: Client, batchId: string, month: string) {
  const [students, lists, rounds] = await Promise.all([
    supabase.rpc("post_month_students", { p_batch: batchId, p_month: monthKeyToDate(month) }),
    supabase.rpc("post_lists", { p_batch: batchId, p_month: monthKeyToDate(month) }),
    supabase
      .from("post_rounds")
      .select("*, post_parcels(status, tracking_no)")
      .eq("batch_id", batchId)
      .eq("month", monthKeyToDate(month))
      .order("created_at"),
  ]);
  if (students.error) throw new Error(students.error.message);
  if (lists.error) throw new Error(lists.error.message);

  return {
    lists: (lists.data ?? []).map(
      (l): PostList => ({
        classId: l.class_id,
        className: l.class_name,
        isActive: l.is_active,
        fileName: l.file_name,
        uploadedAt: l.uploaded_at,
        students: l.students,
        withAddress: l.with_address,
      }),
    ),
    students: (students.data ?? []).map(
      (s): PostStudent => ({
        studentKey: s.student_key,
        name: s.full_name,
        classes: s.classes,
        whatsapp: s.whatsapp,
        address: s.address,
        checked: s.checked,
        problem: s.problem,
        tutesDue: s.tutes_due,
        tutesSent: s.tutes_sent,
      }),
    ),
    rounds: (rounds.data ?? []).map((r): PostRoundSummary => {
      const live = r.post_parcels.filter((p) => p.status !== "void");
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        createdAt: r.created_at,
        handedOverAt: r.handed_over_at,
        receiptTotal: r.receipt_total,
        parcels: live.length,
        packed: live.filter((p) => p.status !== "planned").length,
        tracked: live.filter((p) => p.tracking_no).length,
      };
    }),
  };
}

export async function getPostRound(supabase: Client, id: string): Promise<PostRound | null> {
  const [{ data: round }, { data: parcels }, { data: items }] = await Promise.all([
    supabase.from("post_rounds").select("*").eq("id", id).maybeSingle(),
    supabase.from("post_parcels").select("*").eq("round_id", id).order("number"),
    supabase
      .from("post_parcel_items")
      .select("parcel_id, class_tutes(name), post_parcels!inner(round_id)")
      .eq("post_parcels.round_id", id),
  ]);
  if (!round) return null;

  const tutesByParcel = new Map<string, string[]>();
  for (const it of items ?? []) {
    const list = tutesByParcel.get(it.parcel_id) ?? [];
    list.push(it.class_tutes?.name ?? "?");
    tutesByParcel.set(it.parcel_id, list);
  }
  const parcelList = (parcels ?? []).map(
    (p): PostParcel => ({
      id: p.id,
      number: p.number,
      name: p.full_name,
      whatsapp: p.whatsapp,
      address: p.address,
      district: p.district,
      trackingNo: p.tracking_no,
      status: p.status,
      waSentAt: p.wa_sent_at,
      tutes: (tutesByParcel.get(p.id) ?? []).sort(),
    }),
  );
  const live = parcelList.filter((p) => p.status !== "void");
  return {
    id: round.id,
    batchId: round.batch_id,
    month: round.month.slice(0, 7),
    kind: round.kind,
    status: round.status,
    createdAt: round.created_at,
    handedOverAt: round.handed_over_at,
    receiptTotal: round.receipt_total,
    parcels: live.length,
    packed: live.filter((p) => p.status !== "planned").length,
    tracked: live.filter((p) => p.trackingNo).length,
    parcelList,
  };
}
