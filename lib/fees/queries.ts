import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/supabase/all-rows";
import type { Database, FeeFollowupStatus } from "@/lib/supabase/database.types";
import type { ConcessionLabelMatch, FollowupRecord, MonthStudentRow } from "@/lib/fees/compare";
import { normalizeWaPhone } from "@/lib/fees/phone";
import { dateToMonthKey, monthKeyToDate } from "@/lib/core/month";

export type FeeClassItem = {
  id: string;
  batchId: string;
  batchName: string;
  name: string;
  isActive: boolean;
  /** Uploaded month keys ("YYYY-MM") newest first. */
  months: {
    month: string;
    fileName: string;
    rawRowCount: number;
    uniqueStudentCount: number;
    duplicatesMerged: number;
    uploadedAt: string;
    uploadedByName: string | null;
  }[];
};

export type FeeTemplateItem = {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
  updatedAt: string;
};

export type ClassTuteCatalogItem = {
  id: string;
  batchId: string;
  classId: string | null;
  code: string;
  name: string;
  isActive: boolean;
};

export type ScheduledMonthTute = {
  id: string;
  classId: string;
  /** "YYYY-MM" (supports past, current, and future months). */
  month: string;
  tuteId: string;
  tuteName: string;
  tuteCode: string;
  sortOrder: number;
  note: string;
};

/** Load all batches, fee classes, uploaded month snapshots, and WhatsApp templates. */
export async function getFeeWorkspaceBase(supabase: SupabaseClient<Database>): Promise<{
  batches: { id: string; name: string; isActive: boolean }[];
  classes: FeeClassItem[];
  templates: FeeTemplateItem[];
}> {
  const [{ data: batches }, { data: classes }, { data: imports }, { data: templates }, { data: directory }] =
    await Promise.all([
      supabase.from("batches").select("id, name, is_active, sort_order").order("sort_order").order("name"),
      supabase.from("fee_classes").select("id, batch_id, name, is_active, created_at").order("name"),
      supabase
        .from("fee_month_imports")
        .select("class_id, month, file_name, raw_row_count, unique_student_count, duplicates_merged, uploaded_by, uploaded_at")
        .order("month", { ascending: false }),
      supabase
        .from("fee_message_templates")
        .select("id, name, body, is_default, updated_at")
        .order("is_default", { ascending: false })
        .order("name"),
      supabase.rpc("team_directory"),
    ]);

  const batchList = (batches ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active }));
  const batchName = new Map(batchList.map((b) => [b.id, b.name]));
  const nameById = new Map((directory ?? []).map((p) => [p.id, p.name]));

  const importsByClass = new Map<string, FeeClassItem["months"]>();
  for (const imp of imports ?? []) {
    const list = importsByClass.get(imp.class_id) ?? [];
    list.push({
      month: dateToMonthKey(imp.month),
      fileName: imp.file_name,
      rawRowCount: imp.raw_row_count,
      uniqueStudentCount: imp.unique_student_count,
      duplicatesMerged: imp.duplicates_merged,
      uploadedAt: imp.uploaded_at,
      uploadedByName: imp.uploaded_by ? nameById.get(imp.uploaded_by) ?? null : null,
    });
    importsByClass.set(imp.class_id, list);
  }

  return {
    batches: batchList,
    classes: (classes ?? []).map((c) => ({
      id: c.id,
      batchId: c.batch_id,
      batchName: batchName.get(c.batch_id) ?? "",
      name: c.name,
      isActive: c.is_active,
      months: importsByClass.get(c.id) ?? [],
    })),
    templates: (templates ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      body: t.body,
      isDefault: t.is_default,
      updatedAt: t.updated_at,
    })),
  };
}

/** Load paid students for two months, follow-ups for the current due month, and optional concession labels. */
export async function getClassComparisonData(
  supabase: SupabaseClient<Database>,
  params: { classId: string; batchId: string; prevMonth: string | null; currMonth: string | null },
): Promise<{
  prevStudents: MonthStudentRow[];
  currStudents: MonthStudentRow[];
  followups: FollowupRecord[];
  concessionLabels: ConcessionLabelMatch[];
}> {
  const { classId, batchId, prevMonth, currMonth } = params;
  const fetchMonth = (monthKey: string | null) => {
    if (!monthKey) return Promise.resolve([] as Database["public"]["Tables"]["fee_month_students"]["Row"][]);
    const monthDate = monthKeyToDate(monthKey);
    return allRows((from, to) =>
      supabase
        .from("fee_month_students")
        .select("*")
        .eq("class_id", classId)
        .eq("month", monthDate)
        .order("id")
        .range(from, to),
    );
  };

  const fetchFollowups = currMonth
    ? allRows((from, to) =>
        supabase
          .from("fee_due_followups")
          .select("*")
          .eq("class_id", classId)
          .eq("due_month", monthKeyToDate(currMonth))
          .order("id")
          .range(from, to),
      )
    : Promise.resolve([] as Database["public"]["Tables"]["fee_due_followups"]["Row"][]);

  const [prevRaw, currRaw, followupRaw, { data: directory }, { data: concessions }] = await Promise.all([
    fetchMonth(prevMonth),
    fetchMonth(currMonth),
    fetchFollowups,
    supabase.rpc("team_directory"),
    supabase.rpc("fee_batch_concession_labels", { p_batch_id: batchId }),
  ]);

  const nameById = new Map((directory ?? []).map((p) => [p.id, p.name]));

  const mapStudent = (r: Database["public"]["Tables"]["fee_month_students"]["Row"]): MonthStudentRow => ({
    id: r.id,
    studentKey: r.student_key,
    fullName: r.full_name,
    emailNorm: r.email_norm,
    rawEmail: r.raw_email,
    whatsappNorm: r.whatsapp_norm,
    rawWhatsapp: r.raw_whatsapp,
    mobileNorm: r.mobile_norm,
    rawMobile: r.raw_mobile,
    institute: r.institute,
    district: r.district,
    isNewStudent: r.is_new_student,
    amount: r.amount !== null ? Number(r.amount) : null,
    exportLabel: r.export_label,
    rawClasses: r.raw_classes,
  });

  const followups: FollowupRecord[] = followupRaw.map((f) => ({
    id: f.id,
    studentKey: f.student_key,
    studentName: f.student_name,
    emailNorm: f.email_norm,
    whatsappNorm: f.whatsapp_norm,
    status: f.status as FeeFollowupStatus,
    label: f.label,
    messageCount: f.message_count,
    lastMessagedAt: f.last_messaged_at,
    lastMessagedBy: f.last_messaged_by,
    lastMessagedByName: f.last_messaged_by ? nameById.get(f.last_messaged_by) ?? null : null,
    lastTemplateId: f.last_template_id,
    note: f.note,
    updatedAt: f.updated_at,
  }));

  const concessionLabels: ConcessionLabelMatch[] = (concessions ?? []).map((c) => ({
    fullName: c.full_name,
    cardType: c.card_type,
    phones: (c.phones ?? []).map((p) => normalizeWaPhone(p)).filter((p): p is string => p !== null),
  }));

  return {
    prevStudents: prevRaw.map(mapStudent),
    currStudents: currRaw.map(mapStudent),
    followups,
    concessionLabels,
  };
}

/** Load the reusable tute catalog for a batch and all scheduled months (past, current, future) for a class. */
export async function getClassTutesData(
  supabase: SupabaseClient<Database>,
  params: { batchId: string; classId: string | null },
): Promise<{
  catalog: ClassTuteCatalogItem[];
  scheduled: ScheduledMonthTute[];
}> {
  const { batchId, classId } = params;
  if (!batchId) return { catalog: [], scheduled: [] };

  const [{ data: catalogRows }, { data: monthRows }] = await Promise.all([
    supabase
      .from("class_tutes")
      .select("id, batch_id, class_id, code, name, is_active")
      .eq("batch_id", batchId)
      .order("name"),
    classId
      ? supabase
          .from("class_month_tutes")
          .select("id, class_id, month, tute_id, sort_order, note, created_at")
          .eq("class_id", classId)
          .order("month", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Database["public"]["Tables"]["class_month_tutes"]["Row"][] }),
  ]);

  const catalog: ClassTuteCatalogItem[] = (catalogRows ?? []).map((t) => ({
    id: t.id,
    batchId: t.batch_id,
    classId: t.class_id,
    code: t.code,
    name: t.name,
    isActive: t.is_active,
  }));
  const byId = new Map(catalog.map((t) => [t.id, t]));

  const scheduled: ScheduledMonthTute[] = (monthRows ?? [])
    .map((m) => {
      const tute = byId.get(m.tute_id);
      if (!tute) return null;
      return {
        id: m.id,
        classId: m.class_id,
        month: dateToMonthKey(m.month),
        tuteId: m.tute_id,
        tuteName: tute.name,
        tuteCode: tute.code,
        sortOrder: m.sort_order,
        note: m.note,
      };
    })
    .filter((x): x is ScheduledMonthTute => x !== null);

  return { catalog, scheduled };
}
