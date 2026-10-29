"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { announcementSchema, fieldErrorsOf, firstError, idSchema, type AnnouncementInput } from "@/lib/validation";

function revalidateNotices() {
  revalidatePath("/admin/notices");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function saveAnnouncementAction(input: AnnouncementInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "notices", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { id, title, body, pinned, expires_on } = parsed.data;
  const values = { title, body: body || null, pinned, expires_on: expires_on || null };

  const { error } = id
    ? await ctx.supabase.from("announcements").update(values).eq("id", id)
    : await ctx.supabase.from("announcements").insert({ ...values, created_by: ctx.profile.id });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateNotices();
  return { ok: true, message: id ? "Notice updated" : "Notice posted" };
}

export async function deleteAnnouncementAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "notices", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid notice." };

  const { error } = await ctx.supabase.from("announcements").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateNotices();
  return { ok: true, message: "Notice deleted" };
}
