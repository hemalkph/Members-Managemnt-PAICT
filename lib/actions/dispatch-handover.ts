"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { NOT_ALLOWED } from "@/lib/auth";
import { dispatchActionContext } from "@/lib/dispatch/access";
import { receiptExtension, receiptLooksRight, SETTABLE, type HandoverScanResult } from "@/lib/dispatch/delivery";
import { cleanScan } from "@/lib/dispatch/scanner";
import { normalisePhone } from "@/lib/dispatch/phone";
import type { Json } from "@/lib/database.types";
import { firstError, uuid } from "@/lib/validation";

function revalidateRound(roundId: string) {
  revalidatePath(`/admin/dispatch/rounds/${roundId}`, "layout");
  revalidatePath("/admin/dispatch");
}

const reason = z.string().trim().min(3, "Give a reason").max(300);

// ---------------------------------------------------------------- handover (verify permission)

export async function openHandoverAction(input: { round_id: string }): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(input.round_id).success) return { ok: false, error: "Round not found." };
  const ctx = await dispatchActionContext("verify");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { data, error } = await ctx.supabase.rpc("handover_open", { p_round: input.round_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(input.round_id);
  return { ok: true, data: { id: data } };
}

/** Add a scanned parcel to the open handover. Never throws for a bad scan; the result says why. */
export async function handoverScanAction(input: { handover_id: string; code: string }): Promise<ActionResult<HandoverScanResult>> {
  const parsed = z.object({ handover_id: uuid, code: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid scan." };
  const code = cleanScan(parsed.data.code);
  if (!code) return { ok: false, error: "Nothing was scanned." };
  const ctx = await dispatchActionContext("verify");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { data, error } = await ctx.supabase.rpc("handover_scan", { p_handover: parsed.data.handover_id, p_code: code });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: data as unknown as HandoverScanResult };
}

export async function releaseFromHandoverAction(input: { handover_id: string; parcel_id: string; round_id: string }): Promise<ActionResult> {
  const parsed = z.object({ handover_id: uuid, parcel_id: uuid, round_id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const ctx = await dispatchActionContext("verify");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("handover_release", { p_handover: parsed.data.handover_id, p_parcel: parsed.data.parcel_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: "Removed from the handover" };
}

/**
 * The browser uploaded a receipt to receipts/<round>/: check it and record it.
 * Returns the file id to pass to the confirm.
 */
async function recordReceipt(ctx: NonNullable<Awaited<ReturnType<typeof dispatchActionContext>>>, roundId: string, path: string, name: string) {
  const ext = receiptExtension(path);
  if (!ext || !new RegExp(`^receipts/${roundId}/[0-9a-f-]{36}\\.${ext}$`).test(path)) throw new Error("Invalid receipt upload.");
  const { data, error } = await ctx.supabase.storage.from("dispatch").download(path);
  if (error || !data) throw new Error("The receipt did not arrive. Please try again.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!receiptLooksRight(ext, bytes)) throw new Error("The receipt must be a photo (JPG, PNG, WebP) or a PDF.");
  const { data: id, error: recError } = await ctx.supabase.rpc("carrier_file_record", {
    p_round: roundId,
    p_kind: "handover_receipt",
    p_path: path,
    p_name: name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || `receipt.${ext}`,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_size: bytes.length,
    p_rows: null,
    p_summary: {},
  });
  if (recError) throw new Error(friendlyDbError(recError));
  return id as string;
}

const confirmSchema = z.object({
  round_id: uuid,
  handover_id: uuid,
  counted: z.number().int().min(1, "Count the parcels").max(5000),
  courier_rep: z.string().trim().max(100),
  courier_ref: z.string().trim().max(100),
  note: z.string().trim().max(300),
  receipt: z.object({ path: z.string().max(200), name: z.string().max(200) }).nullable(),
});

/** Confirm the handover. The counted number must equal the scanned number (checked by the database). */
export async function confirmHandoverAction(input: z.input<typeof confirmSchema>): Promise<ActionResult<{ handed: number }>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("verify");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  let receiptId: string | null = null;
  if (v.receipt) {
    try {
      receiptId = await recordReceipt(ctx, v.round_id, v.receipt.path, v.receipt.name);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const { data, error } = await ctx.supabase.rpc("handover_confirm", {
    p_handover: v.handover_id,
    p_counted: v.counted,
    p_courier_rep: v.courier_rep,
    p_courier_ref: v.courier_ref,
    p_note: v.note,
    p_receipt: receiptId,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(v.round_id);
  return { ok: true, message: `Handed ${data} parcel${data === 1 ? "" : "s"} to the courier`, data: { handed: data } };
}

export async function cancelHandoverAction(input: { handover_id: string; round_id: string; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ handover_id: uuid, round_id: uuid, reason: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("verify");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("handover_cancel", { p_handover: parsed.data.handover_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: "Handover cancelled – its parcels are free again" };
}

// ---------------------------------------------------------------- delivery (courier permission)

const deliverySchema = z.object({
  round_id: uuid,
  parcel_ids: z.array(uuid).min(1, "Choose parcels").max(5000),
  state: z.enum(SETTABLE as [string, ...string[]]),
  reason: z.string().trim().max(300),
  evidence: z.string().trim().max(300),
});

export async function setDeliveryAction(
  input: z.input<typeof deliverySchema>,
): Promise<ActionResult<{ changed: number; skipped: { reference: string; state: string }[] }>> {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("courier");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("delivery_set", {
    p_parcels: v.parcel_ids,
    p_state: v.state,
    p_reason: v.reason,
    p_evidence: v.evidence || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  const result = data as unknown as { changed: number; skipped: { reference: string; state: string }[] };
  revalidateRound(v.round_id);
  return {
    ok: true,
    message: `Updated ${result.changed} parcel${result.changed === 1 ? "" : "s"}${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}`,
    data: result,
  };
}

// ---------------------------------------------------------------- void and send again (correct permission)

export async function voidParcelAction(input: { parcel_id: string; round_id: string; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ parcel_id: uuid, round_id: uuid, reason }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("correct");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { error } = await ctx.supabase.rpc("parcel_void", { p_parcel: parsed.data.parcel_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: "Parcel voided" };
}

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .transform((v, c) => {
    if (!v) return "";
    const p = normalisePhone(v).value;
    if (!p) {
      c.addIssue({ code: "custom", message: "Enter a valid Sri Lankan phone number" });
      return z.NEVER;
    }
    return p;
  });

const replaceSchema = z.object({
  parcel_id: uuid,
  round_id: uuid,
  reason,
  recipient: z
    .object({
      name: z.string().trim().min(1, "Enter the name").max(120),
      address_line1: z.string().trim().min(1, "Enter the address").max(200),
      address_line2: z.string().trim().max(200),
      address_line3: z.string().trim().max(200),
      city: z.string().trim().min(1, "Enter the city").max(60),
      phone1: optionalPhone.refine((v) => v !== "", "Enter a phone number"),
      phone2: optionalPhone,
    })
    .nullable(),
  cod_expected: z.number().min(0).max(1000000).nullable(),
  tute_ids: z.array(uuid).min(1, "Choose at least one tute").max(30).nullable(),
});

/** Void the parcel (if needed) and create a replacement with the next R number. */
export async function replaceParcelAction(input: z.input<typeof replaceSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("correct");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  const changes: { [key: string]: Json } = {};
  if (v.recipient) changes.recipient = { ...v.recipient, phone2: v.recipient.phone2 || null };
  if (v.cod_expected !== null) changes.cod_expected = v.cod_expected;
  if (v.tute_ids) changes.tute_ids = v.tute_ids;
  const { data, error } = await ctx.supabase.rpc("parcel_replace", { p_parcel: v.parcel_id, p_reason: v.reason, p: changes });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(v.round_id);
  return { ok: true, message: "Replacement parcel created – register it with Citypak, then import its tracking number", data: { id: data } };
}
