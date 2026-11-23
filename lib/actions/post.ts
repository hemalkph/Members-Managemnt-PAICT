"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate } from "@/lib/core/month";
import {
  firstError,
  idSchema,
  postAddressSchema,
  postHandoverSchema,
  postParcelStatusSchema,
  postRoundBuildSchema,
  postTrackingSchema,
  uuid,
  type PostAddressInput,
  type PostHandoverInput,
  type PostParcelStatusInput,
  type PostRoundBuildInput,
  type PostTrackingInput,
} from "@/lib/core/validation";
import { z } from "zod";

const editor = () => getActionContext({ page: "post", edit: true });

function revalidate() {
  revalidatePath("/admin/post", "layout");
  revalidatePath("/admin/tutes");
}

const done = (error: { code?: string; message?: string } | null, message: string): ActionResult => {
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message };
};

export async function savePostAddressAction(input: PostAddressInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = postAddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_address_save", {
    p_student_key: parsed.data.student_key,
    p_address: parsed.data.address,
    p_checked: parsed.data.checked,
  });
  return done(error, parsed.data.checked ? "Address confirmed" : "Address saved");
}

export async function confirmPostAddressesAction(keys: string[]): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = z.array(z.string().min(2).max(200)).max(5000).safeParse(keys);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { data: n, error } = await ctx.supabase.rpc("post_addresses_confirm", { p_keys: parsed.data });
  return done(error, `${n ?? 0} address${n === 1 ? "" : "es"} confirmed`);
}

export async function buildPostRoundAction(input: PostRoundBuildInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = postRoundBuildSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { data: id, error } = await ctx.supabase.rpc("post_round_build", {
    p_batch: parsed.data.batch_id,
    p_month: monthKeyToDate(parsed.data.month),
    p_kind: parsed.data.kind,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Round ready to pack", data: { id } };
}

export async function packParcelAction(input: { id: string; packed: boolean }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = z.object({ id: uuid, packed: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_parcel_pack", { p_parcel: parsed.data.id, p_packed: parsed.data.packed });
  return done(error, parsed.data.packed ? "Packed" : "Marked not packed");
}

export async function setTrackingAction(input: PostTrackingInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = postTrackingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_parcel_set_tracking", {
    p_parcel: parsed.data.id,
    p_tracking: parsed.data.tracking,
  });
  return done(error, parsed.data.tracking ? "Tracking number saved" : "Tracking number removed");
}

export async function voidParcelAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_parcel_void", { p_parcel: parsed.data.id });
  return done(error, "Parcel taken out of the round");
}

export async function cancelRoundAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_round_cancel", { p_round: parsed.data.id });
  return done(error, "Round cancelled; its copies are free again");
}

export async function handOverRoundAction(input: PostHandoverInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = postHandoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { data: n, error } = await ctx.supabase.rpc("post_round_handover", {
    p_round: parsed.data.id,
    p_receipt_total: parsed.data.receipt_total,
  });
  return done(error, n ? `${n} parcels handed over` : "Already handed over");
}

export async function setParcelStatusAction(input: PostParcelStatusInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = postParcelStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_parcel_set_status", {
    p_parcel: parsed.data.id,
    p_status: parsed.data.status,
    p_copies_ok: parsed.data.copies_ok,
  });
  const message = {
    delivered: "Marked delivered",
    returned: parsed.data.copies_ok ? "Marked returned; copies back in stock" : "Marked returned",
    lost: "Marked lost",
  }[parsed.data.status];
  return done(error, message);
}

export async function whatsappSentAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("post_parcel_whatsapp_sent", { p_parcel: parsed.data.id });
  return done(error, "Marked as sent");
}
