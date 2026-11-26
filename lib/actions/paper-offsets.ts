"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { firstError } from "@/lib/core/validation";
import { STAGE_LABEL, STAGES } from "@/lib/papers";
import type { Json, PaperStageName } from "@/lib/supabase/database.types";

const day = z.number().int().min(-30).max(30);
const schema = z
  .object({ stage: z.enum(STAGES.map((s) => s.stage) as [PaperStageName, ...PaperStageName[]]), start: day, due: day })
  .refine((d) => d.start <= d.due, { message: "The start can't be after the due day" });

/** Apply a timing suggestion: new papers start this stage on these days (admins only). */
export async function applyOffsetSuggestionAction(input: z.input<typeof schema>): Promise<ActionResult> {
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: current, error: readErr } = await ctx.supabase.rpc("paper_stage_offsets");
  if (readErr) return { ok: false, error: friendlyDbError(readErr) };
  const next: Json = {
    ...((current ?? {}) as Record<string, Json>),
    [parsed.data.stage]: { start: parsed.data.start, due: parsed.data.due },
  };

  const { error } = await ctx.supabase.rpc("paper_stage_offsets_set", { p_offsets: next });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/papers");
  revalidatePath("/admin/papers/countdown");
  return { ok: true, message: `New papers now start ${STAGE_LABEL[parsed.data.stage]} earlier.` };
}
