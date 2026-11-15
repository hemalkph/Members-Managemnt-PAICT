import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConcessionCard,
  ConcessionRelationship,
  ConcessionStatus,
  Database,
} from "@/lib/supabase/database.types";
import { todayISO } from "@/lib/core/month";
import { allRows } from "@/lib/supabase/all-rows";
import type { FlagView } from "@/lib/students/flags";
import { missingItems } from "@/lib/students/rules";

type Client = SupabaseClient<Database>;

export type StudentRow = {
  id: string;
  studentNo: string;
  fullName: string;
  batchId: string;
  centreId: string | null;
  card: ConcessionCard;
  status: ConcessionStatus;
  statusChangedAt: string;
  updatedAt: string;
  createdAt: string;
  /** What is still needed before verifying (empty = ready). */
  missing: string[];
  certificateIssuedOn: string | null;
};

export type StudentDetail = StudentRow & {
  gnDivision: string;
  reason: string;
  monthlyAmount: number | null;
  consentOn: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdBy: string | null;
  everVerified: boolean;
  guardians: {
    id: string;
    relationship: ConcessionRelationship;
    fullName: string;
    occupation: string;
    phone: string | null;
  }[];
  files: { id: string; fileName: string; sizeBytes: number; mimeType: string | null; uploadedBy: string | null; createdAt: string }[];
  history: { id: number; card: ConcessionCard; status: ConcessionStatus; note: string; changedBy: string | null; changedAt: string }[];
  flags: FlagView[];
};

function countBy(rows: { student_id: string }[] | null) {
  const map = new Map<string, number>();
  for (const r of rows ?? []) map.set(r.student_id, (map.get(r.student_id) ?? 0) + 1);
  return map;
}

/**
 * Every concession student with what they still need. RLS returns nothing
 * without the Students page.
 */
export async function getConcessionStudents(supabase: Client): Promise<StudentRow[]> {
  const [students, privates, guardians, files] = await Promise.all([
    allRows((a, b) => supabase.from("concession_students").select("*").order("full_name").order("id").range(a, b)),
    allRows((a, b) =>
      supabase
        .from("concession_student_private")
        .select("student_id, gn_division, certificate_issued_on, consent_on, monthly_amount")
        .order("student_id")
        .range(a, b),
    ),
    allRows((a, b) => supabase.from("concession_guardians").select("student_id").order("id").range(a, b)),
    allRows((a, b) => supabase.from("concession_documents").select("student_id").order("id").range(a, b)),
  ]);
  const privateOf = new Map((privates ?? []).map((p) => [p.student_id, p]));
  const guardianCount = countBy(guardians);
  const fileCount = countBy(files);
  const today = todayISO();

  return students.map((s) => {
    const p = privateOf.get(s.id);
    return {
      id: s.id,
      studentNo: s.student_no,
      fullName: s.full_name,
      batchId: s.batch_id,
      centreId: s.centre_id,
      card: s.card_type,
      status: s.status,
      statusChangedAt: s.status_changed_at,
      updatedAt: s.updated_at,
      createdAt: s.created_at,
      certificateIssuedOn: p?.certificate_issued_on ?? null,
      missing: missingItems({
        card: s.card_type,
        files: fileCount.get(s.id) ?? 0,
        guardians: guardianCount.get(s.id) ?? 0,
        gnDivision: p?.gn_division ?? "",
        certificateIssuedOn: p?.certificate_issued_on ?? null,
        consentOn: p?.consent_on ?? null,
        monthlyAmount: p?.monthly_amount === null || p?.monthly_amount === undefined ? null : Number(p.monthly_amount),
        today,
      }),
    };
  });
}

/** One student with everything the admin page shows, or null. Names of staff are resolved. */
export async function getConcessionStudent(supabase: Client, id: string): Promise<StudentDetail | null> {
  const { data: s } = await supabase.from("concession_students").select("*").eq("id", id).maybeSingle();
  if (!s) return null;
  const [{ data: p }, { data: guardians }, { data: files }, { data: history }, { data: flags }] = await Promise.all([
    supabase.from("concession_student_private").select("*").eq("student_id", id).maybeSingle(),
    supabase.from("concession_guardians").select("*").eq("student_id", id).order("created_at"),
    supabase.from("concession_documents").select("*").eq("student_id", id).order("created_at"),
    supabase.from("concession_card_history").select("*").eq("student_id", id).order("changed_at", { ascending: false }),
    supabase.from("concession_flags").select("*").eq("student_id", id).order("raised_at", { ascending: false }),
  ]);

  const staffIds = [
    s.created_by,
    p?.verified_by,
    ...(files ?? []).map((f) => f.uploaded_by),
    ...(history ?? []).map((h) => h.changed_by),
    ...(flags ?? []).flatMap((f) => [f.raised_by, f.resolved_by]),
  ].filter((v): v is string => Boolean(v));
  const { data: staff } = staffIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", [...new Set(staffIds)])
    : { data: [] };
  const nameOf = new Map((staff ?? []).map((m) => [m.id, m.full_name || m.email]));
  const name = (uid: string | null | undefined) => (uid ? (nameOf.get(uid) ?? "Someone") : null);

  const monthlyAmount = p?.monthly_amount === null || p?.monthly_amount === undefined ? null : Number(p.monthly_amount);
  return {
    id: s.id,
    studentNo: s.student_no,
    fullName: s.full_name,
    batchId: s.batch_id,
    centreId: s.centre_id,
    card: s.card_type,
    status: s.status,
    statusChangedAt: s.status_changed_at,
    updatedAt: s.updated_at,
    createdAt: s.created_at,
    createdBy: name(s.created_by),
    gnDivision: p?.gn_division ?? "",
    certificateIssuedOn: p?.certificate_issued_on ?? null,
    reason: p?.reason ?? "",
    monthlyAmount,
    consentOn: p?.consent_on ?? null,
    verifiedBy: name(p?.verified_by),
    verifiedAt: p?.verified_at ?? null,
    everVerified: (history ?? []).some((h) => h.status !== "applied"),
    missing: missingItems({
      card: s.card_type,
      files: files?.length ?? 0,
      guardians: guardians?.length ?? 0,
      gnDivision: p?.gn_division ?? "",
      certificateIssuedOn: p?.certificate_issued_on ?? null,
      consentOn: p?.consent_on ?? null,
      monthlyAmount,
      today: todayISO(),
    }),
    guardians: (guardians ?? []).map((g) => ({
      id: g.id,
      relationship: g.relationship,
      fullName: g.full_name,
      occupation: g.occupation,
      phone: g.phone,
    })),
    files: (files ?? []).map((f) => ({
      id: f.id,
      fileName: f.file_name,
      sizeBytes: f.size_bytes,
      mimeType: f.mime_type,
      uploadedBy: name(f.uploaded_by),
      createdAt: f.created_at,
    })),
    history: (history ?? []).map((h) => ({
      id: h.id,
      card: h.card_type,
      status: h.status,
      note: h.note,
      changedBy: name(h.changed_by),
      changedAt: h.changed_at,
    })),
    flags: (flags ?? []).map((f) => ({
      id: f.id,
      kind: f.kind,
      reason: f.reason,
      raisedAt: f.raised_at,
      raisedBy: name(f.raised_by),
      resolvedAt: f.resolved_at,
      resolvedBy: name(f.resolved_by),
      resolveNote: f.resolve_note,
    })),
  };
}
