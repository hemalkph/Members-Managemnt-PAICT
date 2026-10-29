"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, mainAdminUnlocked, NOT_ALLOWED } from "@/lib/auth";
import { sameStoredAccess, toStoredAccess, type PageAccessMap, type PageKey } from "@/lib/page-access";
import { getSiteUrl } from "@/lib/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import {
  adminResetPasswordSchema,
  fieldErrorsOf,
  firstError,
  idSchema,
  memberActiveSchema,
  memberCreateSchema,
  memberUpdateSchema,
  reviewSchema,
  roleSchema,
  sectionSchema,
  type AdminResetPasswordInput,
  type MemberCreateInput,
  type MemberUpdateInput,
  type ReviewInput,
  type RoleInput,
  type SectionInput,
} from "@/lib/validation";

type AdminCtx = NonNullable<Awaited<ReturnType<typeof getActionContext>>>;

/** Admin actions check the page they belong to (with edit rights). */
async function adminCtx(page: PageKey) {
  return getActionContext({ page, edit: true });
}

async function syncRoles(ctx: AdminCtx, userId: string, roleIds: string[]) {
  const wanted = [...new Set(roleIds)];
  const { data: current, error: readError } = await ctx.supabase
    .from("member_roles")
    .select("role_id")
    .eq("user_id", userId);
  if (readError) return readError;

  const have = new Set((current ?? []).map((r) => r.role_id));
  const toRemove = [...have].filter((id) => !wanted.includes(id));
  const toAdd = wanted.filter((id) => !have.has(id));

  if (toRemove.length > 0) {
    const { error } = await ctx.supabase.from("member_roles").delete().eq("user_id", userId).in("role_id", toRemove);
    if (error) return error;
  }
  if (toAdd.length > 0) {
    const { error } = await ctx.supabase
      .from("member_roles")
      .insert(toAdd.map((role_id) => ({ user_id: userId, role_id })));
    if (error) return error;
  }
  return null;
}

function revalidateMembers(id?: string) {
  revalidatePath("/admin", "layout");
  if (id) revalidatePath(`/admin/members/${id}`);
}

// ---------------------------------------------------------------- members

export async function createMemberAction(input: MemberCreateInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await adminCtx("members");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = memberCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;

  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Adding members needs SUPABASE_SERVICE_ROLE_KEY on the server. See the README." };
  }
  const admin = createAdminClient();

  const result =
    v.mode === "invite"
      ? await admin.auth.admin.inviteUserByEmail(v.email, {
          data: { full_name: v.full_name },
          redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
        })
      : await admin.auth.admin.createUser({
          email: v.email,
          password: v.password,
          email_confirm: true,
          user_metadata: { full_name: v.full_name },
        });

  if (result.error || !result.data.user) {
    const message = result.error?.message ?? "";
    if (/already|registered|exists/i.test(message)) {
      return { ok: false, error: "A member with this email already exists.", fieldErrors: { email: ["Already in use"] } };
    }
    if (/rate limit/i.test(message)) {
      return { ok: false, error: "Too many emails sent. Try again later or use “Set a password” instead." };
    }
    return { ok: false, error: "Could not create the member. Please try again." };
  }

  const userId = result.data.user.id;
  const { error: profileError } = await ctx.supabase
    .from("profiles")
    .update({
      full_name: v.full_name,
      phone: v.phone || null,
      whatsapp: v.whatsapp || null,
      nic: v.nic || null,
      is_admin: v.is_admin,
    })
    .eq("id", userId);
  if (profileError) return { ok: false, error: friendlyDbError(profileError) };

  const rolesError = await syncRoles(ctx, userId, v.role_ids);
  if (rolesError) return { ok: false, error: "Member created, but roles could not be saved." };

  await ctx.supabase.rpc("log_event", { p_action: "member.created", p_target: userId });
  revalidateMembers();
  return {
    ok: true,
    message: v.mode === "invite" ? `Invite sent to ${v.email}` : "Member created. Share the password with them.",
    data: { id: userId },
  };
}

export async function updateMemberAction(input: MemberUpdateInput): Promise<ActionResult> {
  const ctx = await adminCtx("members");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = memberUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;

  if (v.id === ctx.profile.id && !v.is_admin) {
    return { ok: false, error: "You can't remove your own admin access." };
  }

  const { data: target } = await ctx.supabase
    .from("profiles")
    .select("is_admin, is_main_admin, page_access")
    .eq("id", v.id)
    .maybeSingle();
  if (!target) return { ok: false, error: "Member not found." };

  // Page access: only main admins (with two-step done) can change it; the
  // database checks the same. Saved as null when it matches the defaults.
  let pageAccessUpdate: { page_access: PageAccessMap | null } | Record<string, never> = {};
  if (v.page_access && (await mainAdminUnlocked(ctx.profile))) {
    const account = { is_admin: v.is_admin, is_main_admin: target.is_main_admin };
    const stored = target.is_main_admin ? null : toStoredAccess(account, v.page_access as PageAccessMap);
    if (!sameStoredAccess(stored, target.page_access)) pageAccessUpdate = { page_access: stored };
  } else if (target.is_admin !== v.is_admin && target.page_access !== null) {
    // Admin turned on/off by someone who can't set page access: start from the
    // new account type's defaults, so old choices don't carry over.
    return { ok: false, error: "This account has custom page access. Ask a main admin to change its admin access." };
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({
      full_name: v.full_name,
      phone: v.phone || null,
      whatsapp: v.whatsapp || null,
      nic: v.nic || null,
      is_admin: v.is_admin,
      ...pageAccessUpdate,
    })
    .eq("id", v.id);
  if (error) return { ok: false, error: friendlyDbError(error) };

  const rolesError = await syncRoles(ctx, v.id, v.role_ids);
  if (rolesError) return { ok: false, error: friendlyDbError(rolesError) };

  revalidateMembers(v.id);
  return { ok: true, message: "Member saved" };
}

export async function setMemberActiveAction(input: { id: string; active: boolean }): Promise<ActionResult> {
  const ctx = await adminCtx("members");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = memberActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid member." };
  const { id, active } = parsed.data;
  if (id === ctx.profile.id) return { ok: false, error: "You can't deactivate your own account." };

  const { error } = await ctx.supabase.from("profiles").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error) };

  // Also block / unblock sign-in at the Auth level when the service key is set.
  if (hasServiceRoleKey()) {
    await createAdminClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  }

  revalidateMembers(id);
  return { ok: true, message: active ? "Member reactivated" : "Member deactivated" };
}

/** Admin sets a new password for another member (needs the service role key). */
export async function resetMemberPasswordAction(input: AdminResetPasswordInput): Promise<ActionResult> {
  const ctx = await adminCtx("members");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = adminResetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { id, password } = parsed.data;

  if (id === ctx.profile.id) {
    return { ok: false, error: "To change your own password, use “Forgot password” on the login page." };
  }
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Resetting passwords needs SUPABASE_SERVICE_ROLE_KEY on the server. See the README." };
  }

  const { data: target } = await ctx.supabase.from("profiles").select("id, full_name").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "Member not found." };

  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) return { ok: false, error: "Could not reset the password. Please try again." };

  // Recorded in the activity log (the password itself is never stored there).
  await ctx.supabase.rpc("log_event", { p_action: "member.password_reset", p_target: id });

  return { ok: true, message: `Password reset for ${target.full_name || "the member"}` };
}

// ---------------------------------------------------------------- review

export async function reviewSubmissionsAction(input: ReviewInput): Promise<ActionResult<{ count: number }>> {
  const ctx = await adminCtx("review");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { ids, decision, comment } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("submissions")
    .update({ status: decision, admin_comment: comment || null })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };

  const count = data?.length ?? 0;
  revalidatePath("/admin", "layout");
  revalidatePath("/work");
  revalidatePath("/dashboard");

  const verb = decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Moved back to pending";
  return { ok: true, message: `${verb} ${count} submission${count === 1 ? "" : "s"}`, data: { count } };
}

// ---------------------------------------------------------------- sections & roles

export async function saveSectionAction(input: SectionInput): Promise<ActionResult> {
  const ctx = await adminCtx("structure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = sectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { id, name, description } = parsed.data;

  let error;
  if (id) {
    ({ error } = await ctx.supabase.from("sections").update({ name, description: description || null }).eq("id", id));
  } else {
    const { data: last } = await ctx.supabase
      .from("sections")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    ({ error } = await ctx.supabase
      .from("sections")
      .insert({ name, description: description || null, sort_order: (last?.sort_order ?? 0) + 1 }));
  }
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Section renamed" : "Section added" };
}

export async function deleteSectionAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await adminCtx("structure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid section." };

  const { error } = await ctx.supabase.from("sections").delete().eq("id", parsed.data.id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "Some roles in this section already have logged work, so it can't be deleted. Rename it instead."
          : friendlyDbError(error),
    };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Section deleted" };
}

export async function saveRoleAction(input: RoleInput): Promise<ActionResult> {
  const ctx = await adminCtx("structure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { id, section_id, name, description } = parsed.data;

  let error;
  if (id) {
    ({ error } = await ctx.supabase
      .from("roles")
      .update({ name, section_id, description: description || null })
      .eq("id", id));
  } else {
    const { data: last } = await ctx.supabase
      .from("roles")
      .select("sort_order")
      .eq("section_id", section_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    ({ error } = await ctx.supabase
      .from("roles")
      .insert({ name, section_id, description: description || null, sort_order: (last?.sort_order ?? 0) + 1 }));
  }
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Role saved" : "Role added" };
}

export async function deleteRoleAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await adminCtx("structure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid role." };

  const { error } = await ctx.supabase.from("roles").delete().eq("id", parsed.data.id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "This role already has logged work, so it can't be deleted. Rename it instead."
          : friendlyDbError(error),
    };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Role deleted" };
}
