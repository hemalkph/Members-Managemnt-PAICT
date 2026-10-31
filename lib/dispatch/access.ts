import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getActionContext, requirePage } from "@/lib/auth";
import type { DispatchCapability } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's dispatch permissions (from the database). Cached per request. */
export const myDispatchCaps = cache(async (): Promise<Set<DispatchCapability>> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("dispatch_my_caps");
  return new Set((data ?? []) as DispatchCapability[]);
});

/**
 * For dispatch pages: needs the dispatch page, and the given permission when
 * one is named (otherwise view access is enough).
 */
export async function requireDispatch(cap?: DispatchCapability | DispatchCapability[]) {
  const { profile, canEdit } = await requirePage("dispatch");
  const caps = await myDispatchCaps();
  const needed = cap === undefined ? [] : Array.isArray(cap) ? cap : [cap];
  if (needed.length > 0 && !needed.some((c) => caps.has(c))) redirect("/admin/dispatch");
  return { profile, canEdit, caps };
}

/** For dispatch Server Actions: page edit access plus the permission, checked again on the server. */
export async function dispatchActionContext(cap: DispatchCapability) {
  const ctx = await getActionContext({ page: "dispatch", edit: true });
  if (!ctx) return null;
  const { data } = await ctx.supabase.rpc("has_dispatch", { p_cap: cap });
  return data === true ? ctx : null;
}
