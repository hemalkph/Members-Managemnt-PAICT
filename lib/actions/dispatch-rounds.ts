"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { dispatchActionContext } from "@/lib/dispatch/access";
import { normalisePhone } from "@/lib/dispatch/phone";
import { isPdf, pdfText } from "@/lib/dispatch/pdf";
import {
  blockingTracking,
  checkWaybills,
  detectTrackingColumns,
  pairsFromText,
  reconcileTracking,
  type ManifestParcel,
  type TrackingResult,
} from "@/lib/dispatch/tracking";
import { ImportFileError, readSheet } from "@/lib/dispatch/xlsx";
import {
  firstError,
  parcelCorrectionSchema,
  roundFileSchema,
  roundSchema,
  roundStudentsSchema,
  roundTutesSchema,
  savedTuteSchema,
  uuid,
  type ParcelCorrectionInput,
  type RoundInput,
  type RoundStudentsInput,
  type RoundTutesInput,
  type SavedTuteInput,
} from "@/lib/validation";

const BUCKET = "dispatch";
type Ctx = NonNullable<Awaited<ReturnType<typeof dispatchActionContext>>>;

function revalidateRound(id?: string) {
  revalidatePath("/admin/dispatch", "layout");
  if (id) revalidatePath(`/admin/dispatch/rounds/${id}`, "layout");
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------- planning

export async function saveRoundAction(input: RoundInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("round_save", {
    p: { ...v, sending_month: `${v.sending_month}-01` },
  });
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(data);
  return { ok: true, message: v.id ? "Round saved" : "Round created", data: { id: data } };
}

export async function setRoundTutesAction(input: RoundTutesInput): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roundTutesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const codes = parsed.data.tutes.map((t) => t.short_code);
  if (new Set(codes).size !== codes.length) return { ok: false, error: "Each tute needs its own short code." };
  const { error } = await ctx.supabase.rpc("round_set_tutes", { p_round: parsed.data.round_id, p_tutes: parsed.data.tutes });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: "Tutes saved" };
}

export async function setRoundStudentsAction(input: RoundStudentsInput): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roundStudentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const rows = parsed.data.rows.map((r) => ({ ...r, cod_amount: r.cod_amount === "" ? null : r.cod_amount }));
  const { data, error } = await ctx.supabase.rpc("round_set_students", { p_round: parsed.data.round_id, p_rows: rows });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: `${data} student${data === 1 ? "" : "s"} in this round` };
}

// ---------------------------------------------------------------- saved tutes (picked when planning a round)

export async function saveSavedTuteAction(input: SavedTuteInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = savedTuteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { data, error } = await ctx.supabase.rpc("dispatch_tute_save", { p: parsed.data });
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/dispatch", "layout");
  return { ok: true, message: parsed.data.id ? "Tute saved" : "Tute added", data: { id: data } };
}

export async function archiveSavedTuteAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Saved tute not found." };
  const { error } = await ctx.supabase.rpc("dispatch_tute_archive", { p_id: input.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/dispatch", "layout");
  return { ok: true, message: "Tute removed from the list" };
}

export async function cancelRoundAction(input: { round_id: string; reason: string }): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.round_id).success) return { ok: false, error: "Round not found." };
  const { error } = await ctx.supabase.rpc("round_cancel", { p_round: input.round_id, p_reason: String(input.reason ?? "").slice(0, 500) });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(input.round_id);
  return { ok: true, message: "Draft cancelled" };
}

export async function finaliseRoundAction(input: { round_id: string }): Promise<ActionResult<{ parcels: number }>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.round_id).success) return { ok: false, error: "Round not found." };
  const { data, error } = await ctx.supabase.rpc("round_finalise", { p_round: input.round_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(input.round_id);
  return { ok: true, message: `Finalised: ${data} parcels with fixed references`, data: { parcels: data ?? 0 } };
}

export async function correctParcelAction(input: ParcelCorrectionInput): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = parcelCorrectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const p1 = normalisePhone(v.recipient.phone1);
  const p2 = normalisePhone(v.recipient.phone2);
  if (!p1.value) return { ok: false, error: "Phone 1 is not a Sri Lankan phone number." };
  if (p2.status === "invalid") return { ok: false, error: "Phone 2 is not a Sri Lankan phone number." };

  const change: Record<string, unknown> = {
    recipient: { ...v.recipient, phone1: p1.value, phone2: p2.value ?? "" },
    tute_ids: v.tute_ids,
  };
  if (v.cod_expected !== "") change.cod_expected = v.cod_expected;
  const { data: parcel } = await ctx.supabase.from("parcels").select("round_id").eq("id", v.parcel_id).maybeSingle();
  const { error } = await ctx.supabase.rpc("parcel_correct", {
    p_parcel: v.parcel_id,
    p: change as never,
    p_reason: v.reason,
    p_row_version: v.row_version,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parcel?.round_id);
  return { ok: true, message: "Parcel corrected – export the manifest again before registering it" };
}

// ---------------------------------------------------------------- courier files

/** The round's parcels as the matching functions need them (courier and plan can read recipients). */
async function manifest(ctx: Ctx, roundId: string): Promise<ManifestParcel[]> {
  const { data } = await ctx.supabase
    .from("parcels")
    .select("id, reference, tracking_no, registration_state, cod_expected, parcel_recipients(name, phone1, city)")
    .eq("round_id", roundId)
    .limit(5000);
  return (data ?? []).map((p) => {
    const r = p.parcel_recipients as unknown as { name: string; phone1: string | null; city: string } | null;
    return {
      id: p.id,
      reference: p.reference,
      trackingNo: p.tracking_no,
      voided: p.registration_state === "voided",
      name: r?.name ?? "",
      phone1: r?.phone1 ?? null,
      city: r?.city ?? "",
      cod: Number(p.cod_expected),
    };
  });
}

async function download(ctx: Ctx, path: string): Promise<Uint8Array> {
  const { data, error } = await ctx.supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new ImportFileError("The upload did not arrive. Please try again.");
  return new Uint8Array(await data.arrayBuffer());
}

export type TrackingPreview = Omit<TrackingResult, "apply"> & { fileId: string; fileName: string; blocking: number };

async function trackingPreview(ctx: Ctx, roundId: string, fileId: string, fileName: string, bytes: Uint8Array) {
  const { sheet } = await readSheet(bytes);
  const cols = detectTrackingColumns(sheet.header);
  if (!cols) throw new ImportFileError('This file has no "Your Reference" and "Citypak Tracking" columns.');
  const parcels = await manifest(ctx, roundId);
  const numbers = [...new Set(sheet.rows.map((r) => (r[cols.tracking] ?? "").trim().toUpperCase()).filter(Boolean))];
  const usedElsewhere = new Set<string>();
  for (let i = 0; i < numbers.length; i += 200) {
    const { data } = await ctx.supabase
      .from("parcels")
      .select("tracking_no, round_id")
      .in("tracking_no", numbers.slice(i, i + 200))
      .neq("round_id", roundId);
    for (const p of data ?? []) if (p.tracking_no) usedElsewhere.add(p.tracking_no);
  }
  const result = reconcileTracking(sheet, cols, parcels, usedElsewhere);
  return { result, preview: { ...result, apply: undefined, fileId, fileName, blocking: blockingTracking(result) } };
}

/** The browser uploaded a processed Citypak sheet: record it and show what would change. Saves no tracking numbers. */
export async function startTrackingImportAction(input: {
  round_id: string;
  path: string;
  file_name: string;
}): Promise<ActionResult<TrackingPreview>> {
  const ctx = await dispatchActionContext("courier");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roundFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const { round_id, path } = parsed.data;
  if (!new RegExp(`^rounds/${round_id}/[0-9a-f-]{36}\\.(xlsx|csv)$`).test(path)) return { ok: false, error: "Invalid upload." };
  const fileName = parsed.data.file_name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || "citypak.xlsx";
  try {
    const bytes = await download(ctx, path);
    const { sheet } = await readSheet(bytes);
    const { data: fileId, error } = await ctx.supabase.rpc("carrier_file_record", {
      p_round: round_id,
      p_kind: "tracking_sheet",
      p_path: path,
      p_name: fileName,
      p_sha256: sha256(bytes),
      p_size: bytes.length,
      p_rows: sheet.rows.length,
      p_summary: {},
    });
    if (error || !fileId) return { ok: false, error: friendlyDbError(error) };
    const { preview } = await trackingPreview(ctx, round_id, fileId, fileName, bytes);
    return { ok: true, data: preview };
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The file could not be read." };
  }
}

/** Apply the new tracking numbers from a recorded sheet. Re-reads and re-checks the file on the server. */
export async function applyTrackingAction(input: { round_id: string; file_id: string }): Promise<ActionResult<{ applied: number }>> {
  const ctx = await dispatchActionContext("courier");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.round_id).success || !uuid.safeParse(input.file_id).success) return { ok: false, error: "File not found." };
  const { data: file } = await ctx.supabase
    .from("carrier_files")
    .select("id, storage_path, file_name, round_id, kind")
    .eq("id", input.file_id)
    .maybeSingle();
  if (!file || file.round_id !== input.round_id || file.kind !== "tracking_sheet") return { ok: false, error: "File not found." };
  try {
    const { result } = await trackingPreview(ctx, input.round_id, file.id, file.file_name, await download(ctx, file.storage_path));
    if (blockingTracking(result) > 0) return { ok: false, error: "Fix the problems in the file first – nothing was saved." };
    if (result.apply.length === 0) return { ok: true, message: "Nothing new to add", data: { applied: 0 } };
    const { data, error } = await ctx.supabase.rpc("tracking_apply", {
      p_round: input.round_id,
      p_file: file.id,
      p_rows: result.apply,
    });
    if (error) return { ok: false, error: friendlyDbError(error) };
    const applied = Number((data as { applied?: number } | null)?.applied ?? 0);
    revalidateRound(input.round_id);
    return { ok: true, message: `Added ${applied} tracking number${applied === 1 ? "" : "s"}`, data: { applied } };
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The file could not be read." };
  }
}

export type WaybillSummary = {
  pages: number;
  labels: number;
  matched: number;
  mismatched: number;
  unknown: number;
  missingLabels: number;
  examples: string[];
};

/** Store the official Citypak waybill PDF privately and cross-check its labels (never the source of identity). */
export async function recordWaybillAction(input: {
  round_id: string;
  path: string;
  file_name: string;
}): Promise<ActionResult<WaybillSummary>> {
  const ctx = await dispatchActionContext("courier");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roundFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const { round_id, path } = parsed.data;
  if (!new RegExp(`^rounds/${round_id}/[0-9a-f-]{36}\\.pdf$`).test(path)) return { ok: false, error: "Invalid upload." };
  const fileName = parsed.data.file_name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || "waybills.pdf";
  try {
    const bytes = await download(ctx, path);
    if (!isPdf(bytes)) return { ok: false, error: "This is not a PDF file." };
    const { data: round } = await ctx.supabase.from("dispatch_rounds").select("ref_prefix").eq("id", round_id).maybeSingle();
    if (!round) return { ok: false, error: "Round not found." };

    let summary: WaybillSummary;
    try {
      const { pages, text } = await pdfText(bytes);
      const check = checkWaybills(pairsFromText(text, [round.ref_prefix]), await manifest(ctx, round_id));
      summary = {
        pages,
        labels: check.labels,
        matched: check.matched,
        mismatched: check.mismatched.length,
        unknown: check.unknown.length,
        missingLabels: check.missingLabels.length,
        examples: [
          ...check.mismatched.slice(0, 5).map((p) => `${p.trackingNo} ↔ ${p.reference ?? "?"} doesn't match our records`),
          ...check.missingLabels.slice(0, 5).map((r) => `${r}: no label in the PDF`),
        ],
      };
    } catch {
      // The PDF is still stored; only the optional cross-check is skipped.
      summary = { pages: 0, labels: 0, matched: 0, mismatched: 0, unknown: 0, missingLabels: 0, examples: ["The text of this PDF could not be read, so labels were not cross-checked."] };
    }

    const { error } = await ctx.supabase.rpc("carrier_file_record", {
      p_round: round_id,
      p_kind: "waybill_pdf",
      p_path: path,
      p_name: fileName,
      p_sha256: sha256(bytes),
      p_size: bytes.length,
      p_rows: summary.labels,
      p_summary: summary,
    });
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidateRound(round_id);
    return { ok: true, message: "Waybill PDF stored", data: summary };
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The PDF could not be stored." };
  }
}

// ---------------------------------------------------------------- Citypak template (main admins)

export async function storeTemplateAction(input: { path: string; file_name: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: "Only main admins (with two-step login) can store the Citypak template." };
  const path = String(input.path ?? "");
  if (!/^templates\/[0-9a-f-]{36}\.(xlsx|csv)$/.test(path)) return { ok: false, error: "Upload the template as .xlsx or .csv." };
  const fileName = String(input.file_name ?? "").replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || "citypak-template.xlsx";
  try {
    const { data, error: dlError } = await ctx.supabase.storage.from(BUCKET).download(path);
    if (dlError || !data) return { ok: false, error: "The upload did not arrive. Please try again." };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const { sheet } = await readSheet(bytes);
    const { data: fileId, error } = await ctx.supabase.rpc("carrier_file_record", {
      p_round: null,
      p_kind: "citypak_template",
      p_path: path,
      p_name: fileName,
      p_sha256: sha256(bytes),
      p_size: bytes.length,
      p_rows: sheet.rows.length,
      p_summary: { columns: sheet.header },
    });
    if (error || !fileId) return { ok: false, error: friendlyDbError(error) };
    const { error: setError } = await ctx.supabase.rpc("citypak_template_set", { p_file: fileId, p_verified: false });
    if (setError) return { ok: false, error: friendlyDbError(setError) };
    revalidatePath("/admin/dispatch", "layout");
    return { ok: true, message: "Template stored – check its columns, then mark it verified" };
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The template could not be read." };
  }
}

export async function verifyTemplateAction(input: { file_id: string; verified: boolean }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: "Only main admins (with two-step login) can verify the Citypak template." };
  if (!uuid.safeParse(input.file_id).success) return { ok: false, error: "Template not found." };
  const { error } = await ctx.supabase.rpc("citypak_template_set", { p_file: input.file_id, p_verified: Boolean(input.verified) });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/dispatch", "layout");
  return { ok: true, message: input.verified ? "Template marked as verified" : "Template marked as not verified" };
}
