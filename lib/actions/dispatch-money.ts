"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { dispatchActionContext } from "@/lib/dispatch/access";
import { receiptLooksRight } from "@/lib/dispatch/delivery";
import { parsePaymentLines } from "@/lib/dispatch/money";
import { firstError, uuid } from "@/lib/validation";

function revalidateMoney(settlementId?: string) {
  revalidatePath("/admin/dispatch", "layout");
  if (settlementId) revalidatePath(`/admin/dispatch/money/${settlementId}`);
}

const money = z.number().min(0, "Amounts can't be negative").max(100_000_000);
const settlementSchema = z.object({
  id: uuid.nullable(),
  reference: z.string().trim().min(1, "Enter the settlement reference").max(60),
  settled_on: z.iso.date("Enter the settlement date"),
  remitted: money,
  note: z.string().trim().max(300),
});

/** Create or update a draft settlement. */
export async function saveSettlementAction(input: z.input<typeof settlementSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { id, ...p } = parsed.data;
  const { data, error } = await ctx.supabase.rpc("settlement_save", { p_id: id, p });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney(data);
  return { ok: true, message: id ? "Settlement saved" : "Settlement started – now add the parcels it pays for", data: { id: data } };
}

/** Add parcels from a pasted list (tracking/reference, collected?, fee?). */
export async function addSettlementLinesAction(input: {
  settlement_id: string;
  text: string;
}): Promise<ActionResult<{ added: number; problems: { code: string; message: string }[] }>> {
  if (!uuid.safeParse(input.settlement_id).success) return { ok: false, error: "Settlement not found." };
  if (typeof input.text !== "string" || input.text.length > 200_000) return { ok: false, error: "The list is too long." };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { rows, errors } = parsePaymentLines(input.text);
  if (rows.length === 0) return { ok: false, error: errors[0] ? `Line ${errors[0].line}: ${errors[0].message}` : "Paste at least one tracking number or reference." };
  const { data, error } = await ctx.supabase.rpc("settlement_add_lines", { p_id: input.settlement_id, p_rows: rows });
  if (error) return { ok: false, error: friendlyDbError(error) };
  const result = data as unknown as { added: number; problems: { code: string; message: string }[] };
  const problems = [...errors.map((e) => ({ code: e.text || `Line ${e.line}`, message: e.message })), ...result.problems];
  revalidateMoney(input.settlement_id);
  return {
    ok: true,
    message: `Added ${result.added} parcel${result.added === 1 ? "" : "s"}${problems.length ? ` · ${problems.length} not added` : ""}`,
    data: { added: result.added, problems },
  };
}

export async function setSettlementLineAction(input: { settlement_id: string; line_id: string; collected: number; fee: number }): Promise<ActionResult> {
  const parsed = z.object({ settlement_id: uuid, line_id: uuid, collected: money, fee: money }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  const { error } = await ctx.supabase.rpc("settlement_set_line", { p_line: v.line_id, p_collected: v.collected, p_fee: v.fee });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney(v.settlement_id);
  return { ok: true, message: "Saved" };
}

export async function removeSettlementLineAction(input: { settlement_id: string; line_id: string }): Promise<ActionResult> {
  const parsed = z.object({ settlement_id: uuid, line_id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("settlement_remove_line", { p_line: parsed.data.line_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney(parsed.data.settlement_id);
  return { ok: true, message: "Removed" };
}

export async function confirmSettlementAction(input: { settlement_id: string; dispute_note: string }): Promise<ActionResult> {
  const parsed = z.object({ settlement_id: uuid, dispute_note: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("settlement_confirm", { p_id: parsed.data.settlement_id, p_dispute_note: parsed.data.dispute_note || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney(parsed.data.settlement_id);
  return { ok: true, message: "Settlement confirmed – these parcels now count as paid" };
}

export async function cancelSettlementAction(input: { settlement_id: string; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ settlement_id: uuid, reason: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("settlement_cancel", { p_id: parsed.data.settlement_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney(parsed.data.settlement_id);
  return { ok: true, message: "Settlement cancelled" };
}

/** The browser uploaded Citypak's settlement report to settlements/<id>/: check, record and attach it. */
export async function attachSettlementFileAction(input: { settlement_id: string; path: string; file_name: string }): Promise<ActionResult> {
  const parsed = z.object({ settlement_id: uuid, path: z.string().max(200), file_name: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { settlement_id, path } = parsed.data;
  const m = new RegExp(`^settlements/${settlement_id}/[0-9a-f-]{36}\\.(pdf|xlsx|csv|jpg|png|webp)$`).exec(path);
  if (!m) return { ok: false, error: "Invalid upload." };
  const { data: blob, error: dlError } = await ctx.supabase.storage.from("dispatch").download(path);
  if (dlError || !blob) return { ok: false, error: "The upload did not arrive. Please try again." };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = m[1] as "pdf" | "xlsx" | "csv" | "jpg" | "png" | "webp";
  const looksRight =
    ext === "xlsx"
      ? bytes[0] === 0x50 && bytes[1] === 0x4b
      : ext === "csv"
        ? !bytes.subarray(0, 512).includes(0)
        : receiptLooksRight(ext, bytes);
  if (!looksRight) return { ok: false, error: "The file doesn't match its type. Upload a PDF, Excel, CSV or photo." };
  const { data: fileId, error } = await ctx.supabase.rpc("carrier_file_record", {
    p_round: null,
    p_kind: "settlement_report",
    p_path: path,
    p_name: parsed.data.file_name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || `settlement.${ext}`,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_size: bytes.length,
    p_rows: null,
    p_summary: {},
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  const { error: attachError } = await ctx.supabase.rpc("settlement_attach", { p_id: settlement_id, p_file: fileId });
  if (attachError) return { ok: false, error: friendlyDbError(attachError) };
  revalidateMoney(settlement_id);
  return { ok: true, message: "Settlement report attached" };
}

export async function writeOffAction(input: { parcel_id: string; amount: number; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ parcel_id: uuid, amount: money, reason: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("finance");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  const { error } = await ctx.supabase.rpc("cod_writeoff_set", { p_parcel: v.parcel_id, p_amount: v.amount, p_reason: v.reason });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateMoney();
  return { ok: true, message: v.amount > 0 ? "Shortfall written off" : "Write-off removed" };
}

// ---------------------------------------------------------------- closing rounds

export async function closeRoundAction(input: { round_id: string; note: string }): Promise<ActionResult> {
  const parsed = z.object({ round_id: uuid, note: z.string().trim().max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("round_close", { p_round: parsed.data.round_id, p_note: parsed.data.note });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/dispatch", "layout");
  return { ok: true, message: "Round closed" };
}

export async function reopenRoundAction(input: { round_id: string; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ round_id: uuid, reason: z.string().trim().min(3, "Give a reason").max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await getActionContext({ page: "dispatch", edit: true, mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("round_reopen", { p_round: parsed.data.round_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/dispatch", "layout");
  return { ok: true, message: "Round reopened" };
}
