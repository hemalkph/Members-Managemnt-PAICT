"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { fieldErrorsOf, firstError, roleRatesSchema, type RoleRatesInput } from "@/lib/validation";

export type SavedRateItem = { id: string; name: string; unit: string; price: number };

/**
 * Save one role's pay settings: salaried or not, and its rate items
 * (items missing from the list are deleted). Main admins only.
 * Returns the saved items in order so new rows get their ids.
 */
export async function saveRoleRatesAction(input: RoleRatesInput): Promise<ActionResult<{ items: SavedRateItem[] }>> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = roleRatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { role_id, is_salaried, items } = parsed.data;

  const { error: roleError } = await ctx.supabase.from("roles").update({ is_salaried }).eq("id", role_id);
  if (roleError) return { ok: false, error: friendlyDbError(roleError) };

  const { data: existing, error: readError } = await ctx.supabase
    .from("rate_items")
    .select("id")
    .eq("role_id", role_id);
  if (readError) return { ok: false, error: friendlyDbError(readError) };

  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const keepIds = new Set(items.flatMap((i) => (i.id && existingIds.has(i.id) ? [i.id] : [])));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await ctx.supabase.from("rate_items").delete().in("id", toDelete);
    if (error) return { ok: false, error: friendlyDbError(error) };
  }

  for (const [index, item] of items.entries()) {
    const values = { name: item.name, unit: item.unit, price: item.price, sort_order: index + 1 };
    const { error } =
      item.id && keepIds.has(item.id)
        ? await ctx.supabase.from("rate_items").update(values).eq("id", item.id).eq("role_id", role_id)
        : await ctx.supabase.from("rate_items").insert({ ...values, role_id });
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? `“${item.name}” is listed twice for this role.` : friendlyDbError(error),
      };
    }
  }

  const { data: saved } = await ctx.supabase
    .from("rate_items")
    .select("id, name, unit, price")
    .eq("role_id", role_id)
    .order("sort_order");

  revalidatePath("/admin/rates");
  return {
    ok: true,
    message: "Rates saved",
    data: { items: (saved ?? []).map((r) => ({ ...r, price: Number(r.price) })) },
  };
}
