"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import {
  firstError,
  paymentsImportSchema,
  studentsImportSchema,
  type PaymentsImportInput,
  type StudentsImportInput,
} from "@/lib/core/validation";

// Needs the Students page with edit access (the database checks the same).
const editor = () => getActionContext({ page: "students", edit: true });

function revalidate() {
  revalidatePath("/admin/students");
  revalidatePath("/admin/students/analysis");
  revalidatePath("/admin/students/import");
}

/** Add the new students the preview showed. Already registered IDs are skipped. */
export async function importStudentsAction(input: StudentsImportInput): Promise<ActionResult<{ added: number }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = studentsImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: added, error } = await ctx.supabase.rpc("concession_students_import", {
    p_rows: parsed.data.rows,
    p_file_name: parsed.data.file_name,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  const skipped = parsed.data.rows.length - added;
  return {
    ok: true,
    message: `Imported ${added} student${added === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} registered meanwhile, skipped)` : ""}`,
    data: { added },
  };
}

/** Add the new payments the preview showed. Months already recorded are skipped. */
export async function importPaymentsAction(input: PaymentsImportInput): Promise<ActionResult<{ added: number }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paymentsImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: added, error } = await ctx.supabase.rpc("concession_payments_import", {
    p_rows: parsed.data.rows.map((r) => ({ ...r, month: `${r.month}-01` })),
    p_file_name: parsed.data.file_name,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  const skipped = parsed.data.rows.length - added;
  return {
    ok: true,
    message: `Imported ${added} payment${added === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} recorded meanwhile, skipped)` : ""}`,
    data: { added },
  };
}
