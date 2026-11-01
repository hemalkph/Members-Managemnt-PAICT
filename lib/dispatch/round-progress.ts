import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { OPTIONAL_STEPS, type OptionalStep, type RoundProgress } from "./stages";

export type RoundWithProgress = { id: string; name: string; progress: RoundProgress };

/** Progress of the given rounds, counted from their parcels (no personal data). */
export async function loadRoundProgress(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<RoundWithProgress[]> {
  if (ids.length === 0) return [];
  const [{ data: rounds }, { data: parcels }, { data: settings }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state, created_at").in("id", ids).order("created_at"),
    supabase
      .from("parcels")
      .select("round_id, registration_state, pack_state, delivery_state, on_hold")
      .in("round_id", ids)
      .limit(50000),
    supabase.from("dispatch_settings").select("require_verification, optional_steps").limit(1).maybeSingle(),
  ]);
  const verification = Boolean(settings?.require_verification);
  const optional = (settings?.optional_steps ?? OPTIONAL_STEPS).filter((s): s is OptionalStep =>
    (OPTIONAL_STEPS as string[]).includes(s),
  );

  const byRound = new Map<string, RoundProgress>();
  for (const r of rounds ?? []) {
    byRound.set(r.id, {
      state: r.state,
      live: 0,
      registered: 0,
      packed: 0,
      verified: 0,
      onHold: 0,
      handedOver: 0,
      delivered: 0,
      returned: 0,
      failed: 0,
      verification,
      codOwing: 0,
      inDraft: 0,
      optional,
    });
  }
  for (const p of parcels ?? []) {
    const c = byRound.get(p.round_id);
    if (!c || p.registration_state === "voided") continue;
    c.live++;
    if (p.registration_state === "registered") c.registered++;
    if (p.pack_state !== "planned") c.packed++;
    if (p.pack_state === "verified") c.verified++;
    if (p.on_hold) c.onHold++;
    if (p.delivery_state !== "awaiting_pickup") c.handedOver++;
    if (p.delivery_state === "delivered") c.delivered++;
    if (p.delivery_state === "returned") c.returned++;
    if (p.delivery_state === "failed") c.failed++;
  }

  // Money comes from the close check (anyone with the page may read these totals).
  await Promise.all(
    (rounds ?? [])
      .filter((r) => r.state === "finalised" || r.state === "active")
      .map(async (r) => {
        const { data } = await supabase.rpc("round_close_check", { p_round: r.id });
        const c = data as { cod_outstanding?: number; in_draft?: number } | null;
        const prog = byRound.get(r.id)!;
        prog.codOwing = Number(c?.cod_outstanding ?? 0);
        prog.inDraft = Number(c?.in_draft ?? 0);
      }),
  );

  return (rounds ?? []).map((r) => ({ id: r.id, name: r.name, progress: byRound.get(r.id)! }));
}
