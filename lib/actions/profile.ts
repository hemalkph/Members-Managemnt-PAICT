"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { AVATARS_BUCKET } from "@/lib/storage";
import { avatarSchema, fieldErrorsOf, firstError, profileSchema, type ProfileInput } from "@/lib/validation";

export async function updateProfileAction(input: ProfileInput): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };

  const { full_name, phone, whatsapp, nic } = parsed.data;
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ full_name, phone: phone || null, whatsapp: whatsapp || null, nic: nic || null })
    .eq("id", ctx.profile.id);

  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved" };
}

/** Called after the browser uploaded a photo to avatars/<user id>/... */
export async function setAvatarAction(input: { path: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = avatarSchema.safeParse(input);
  if (!parsed.success || !parsed.data.path.startsWith(`${ctx.profile.id}/`)) {
    return { ok: false, error: "Invalid photo." };
  }

  const old = ctx.profile.avatar_path;
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ avatar_path: parsed.data.path })
    .eq("id", ctx.profile.id);
  if (error) return { ok: false, error: friendlyDbError(error) };

  if (old && old !== parsed.data.path) {
    await ctx.supabase.storage.from(AVATARS_BUCKET).remove([old]);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Photo updated" };
}

export async function removeAvatarAction(): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const old = ctx.profile.avatar_path;
  const { error } = await ctx.supabase.from("profiles").update({ avatar_path: null }).eq("id", ctx.profile.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (old) await ctx.supabase.storage.from(AVATARS_BUCKET).remove([old]);

  revalidatePath("/", "layout");
  return { ok: true, message: "Photo removed" };
}
