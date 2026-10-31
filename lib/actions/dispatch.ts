"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { dispatchActionContext } from "@/lib/dispatch/access";
import {
  buildCandidates,
  classify,
  countByStatus,
  detectMapping,
  STUDENT_FIELDS,
  type ExistingStudent,
  type Mapping,
  type PreviewRow,
  type RowStatus,
} from "@/lib/dispatch/import";
import { normalisePhone } from "@/lib/dispatch/phone";
import { ImportFileError, readSheet } from "@/lib/dispatch/xlsx";
import {
  dispatchGrantSchema,
  dispatchSettingsSchema,
  firstError,
  importApplySchema,
  importStepSchema,
  studentSchema,
  uuid,
  type DispatchSettingsInput,
  type StudentInput,
} from "@/lib/validation";

const BUCKET = "dispatch";
const IMPORT_PATH = /^imports\/[0-9a-f-]{36}\.(xlsx|csv)$/;

function revalidateDispatch() {
  revalidatePath("/admin/dispatch", "layout");
}

// ---------------------------------------------------------------- students

export async function saveStudentAction(input: StudentInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const p1 = normalisePhone(v.phone1);
  const p2 = normalisePhone(v.phone2);
  if (p1.status === "invalid") return { ok: false, error: "Phone 1 is not a Sri Lankan phone number." };
  if (p2.status === "invalid") return { ok: false, error: "Phone 2 is not a Sri Lankan phone number." };

  const { data, error } = await ctx.supabase.rpc("student_save", {
    p: {
      id: v.id,
      batch_id: v.batch_id,
      student_no: v.student_no,
      full_name: v.full_name,
      address_line1: v.address_line1,
      address_line2: v.address_line2,
      address_line3: v.address_line3,
      city: v.city,
      region: v.region,
      phone1: p1.value ?? "",
      phone2: p2.value ?? "",
      phone1_raw: p1.raw !== (p1.value ?? "") ? p1.raw : "",
      delivery_note: v.delivery_note,
    },
    p_expected_updated_at: v.id ? v.expected_updated_at || null : null,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? `Student number ${v.student_no} is already used in this batch.` : friendlyDbError(error),
    };
  }
  revalidateDispatch();
  return { ok: true, message: v.id ? "Student saved" : "Student added", data: { id: data } };
}

export async function setStudentActiveAction(input: { id: string; active: boolean }): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.id).success || typeof input.active !== "boolean") return { ok: false, error: "Student not found." };
  const { error } = await ctx.supabase.rpc("student_set_active", { p_id: input.id, p_active: input.active });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateDispatch();
  return { ok: true, message: input.active ? "Student is active again" : "Student marked inactive" };
}

// ---------------------------------------------------------------- import

export type ImportStart = {
  importId: string;
  fileName: string;
  header: string[];
  sample: string[][];
  rowCount: number;
  mapping: Mapping;
};

export type ImportPreview = {
  rows: Omit<PreviewRow, "apply">[];
  counts: Record<RowStatus, number>;
};

type Ctx = NonNullable<Awaited<ReturnType<typeof dispatchActionContext>>>;

/** Download an import file the person uploaded and read it (always on the server). */
async function loadImport(ctx: Ctx, importId: string) {
  const { data: imp } = await ctx.supabase
    .from("student_imports")
    .select("id, batch_id, file_name, storage_path, applied_at")
    .eq("id", importId)
    .maybeSingle();
  if (!imp || !imp.storage_path || !imp.batch_id) throw new ImportFileError("Import not found. Upload the file again.");
  if (imp.applied_at) throw new ImportFileError("This import was already saved.");
  const { data: blob, error } = await ctx.supabase.storage.from(BUCKET).download(imp.storage_path);
  if (error || !blob) throw new ImportFileError("The uploaded file is no longer available. Upload it again.");
  const { sheet } = await readSheet(new Uint8Array(await blob.arrayBuffer()));
  return { imp: { ...imp, batch_id: imp.batch_id }, sheet };
}

/** Never trust a column number from the browser beyond the sheet's width. */
function cleanMapping(mapping: Mapping, width: number): Mapping {
  const out: Mapping = {};
  for (const f of STUDENT_FIELDS) {
    const src = mapping[f.key];
    if (src && src.column >= 0 && src.column < width) out[f.key] = src;
  }
  return out;
}

async function buildPreview(ctx: Ctx, importId: string, rawMapping: Mapping) {
  const { imp, sheet } = await loadImport(ctx, importId);
  const mapping = cleanMapping(rawMapping, sheet.header.length);
  if (!mapping.student_no || !mapping.full_name) {
    throw new ImportFileError("Choose the columns for student number and name.");
  }
  const { data: existing, error } = await ctx.supabase
    .from("students")
    .select(
      "id, student_no, full_name, address_line1, address_line2, address_line3, city, region, phone1, phone2, delivery_note, updated_at, anonymised_at",
    )
    .eq("batch_id", imp.batch_id)
    .limit(10000);
  if (error) throw new ImportFileError("Could not read the saved students. Please try again.");
  const rows = classify(buildCandidates(sheet, mapping), (existing ?? []) as ExistingStudent[], mapping);
  return { imp, rows };
}

/** Step 1: the browser has uploaded the file to the private bucket; check it and record the import. */
export async function startImportAction(input: {
  path: string;
  fileName: string;
  batchId: string;
}): Promise<ActionResult<ImportStart>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!IMPORT_PATH.test(input.path) || !uuid.safeParse(input.batchId).success) {
    return { ok: false, error: "Upload an Excel (.xlsx) or CSV file and choose a batch." };
  }
  const fileName = String(input.fileName ?? "").replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || "students";

  const { data: blob, error: dlError } = await ctx.supabase.storage.from(BUCKET).download(input.path);
  if (dlError || !blob) return { ok: false, error: "The upload did not arrive. Please try again." };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let sheet;
  try {
    sheet = (await readSheet(bytes)).sheet;
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The file could not be read." };
  }
  if (sheet.header.length === 0) return { ok: false, error: "The file has no header row." };

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: importId, error } = await ctx.supabase.rpc("student_import_start", {
    p_batch: input.batchId,
    p_file_name: fileName,
    p_storage_path: input.path,
    p_sha256: sha256,
    p_size: bytes.length,
    p_rows: sheet.rows.length,
  });
  if (error || !importId) return { ok: false, error: friendlyDbError(error) };

  return {
    ok: true,
    data: {
      importId,
      fileName,
      header: sheet.header,
      sample: sheet.rows.slice(0, 3),
      rowCount: sheet.rows.length,
      mapping: detectMapping(sheet.header),
    },
  };
}

/** Steps 2–4: validate with the chosen columns and compare with saved students. Saves nothing. */
export async function previewImportAction(input: { import_id: string; mapping: Mapping }): Promise<ActionResult<ImportPreview>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = importStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  try {
    const { rows } = await buildPreview(ctx, parsed.data.import_id, parsed.data.mapping);
    // The rows to send to the database stay on the server.
    const visible = rows.map((r) => {
      const copy: Partial<PreviewRow> = { ...r };
      delete copy.apply;
      return copy as Omit<PreviewRow, "apply">;
    });
    return { ok: true, data: { rows: visible, counts: countByStatus(rows) } };
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The preview could not be made." };
  }
}

/** Step 5: save only the rows the person ticked. Re-checks everything on the server first. */
export async function applyImportAction(input: {
  import_id: string;
  mapping: Mapping;
  lines: number[];
}): Promise<ActionResult<{ saved: number }>> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = importApplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.lines.length === 0) return { ok: false, error: "Tick at least one row to save." };

  let rows: PreviewRow[];
  try {
    rows = (await buildPreview(ctx, parsed.data.import_id, parsed.data.mapping)).rows;
  } catch (err) {
    return { ok: false, error: err instanceof ImportFileError ? err.message : "The import could not be checked." };
  }
  const wanted = new Set(parsed.data.lines);
  const chosen = rows.filter((r) => wanted.has(r.line) && r.apply !== null);
  if (chosen.length === 0) return { ok: false, error: "None of the ticked rows can be saved. Run the preview again." };

  const counts = countByStatus(rows);
  const { data, error } = await ctx.supabase.rpc("students_import_apply", {
    p_import: parsed.data.import_id,
    p_rows: chosen.map((r) => r.apply!),
    p_counts: { ...counts, approved: chosen.length },
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateDispatch();
  return { ok: true, message: `Saved ${data} student record${data === 1 ? "" : "s"}`, data: { saved: data ?? 0 } };
}

// ---------------------------------------------------------------- settings and permissions

export async function saveDispatchSettingsAction(input: DispatchSettingsInput): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = dispatchSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("dispatch_settings_save", { p: parsed.data });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateDispatch();
  return { ok: true, message: "Dispatch settings saved" };
}

export async function setDispatchGrantAction(input: {
  user_id: string;
  capability: string;
  grant: boolean;
  reason: string;
}): Promise<ActionResult> {
  // Main admins only; the database checks this again (is_main_admin needs two-step).
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: "Only main admins (with two-step login) can change dispatch permissions." };
  const parsed = dispatchGrantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const { error } = v.grant
    ? await ctx.supabase.rpc("dispatch_grant", { p_user: v.user_id, p_cap: v.capability, p_reason: v.reason || null })
    : await ctx.supabase.rpc("dispatch_revoke", { p_user: v.user_id, p_cap: v.capability, p_reason: v.reason || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateDispatch();
  return { ok: true, message: v.grant ? "Permission given" : "Permission removed" };
}
