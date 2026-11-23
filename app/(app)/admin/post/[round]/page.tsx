import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoundWorkspace } from "@/components/post/round-workspace";
import { requirePage } from "@/lib/auth";
import { uuid } from "@/lib/core/validation";
import { getPostRound } from "@/lib/post/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Speed Post round" };

export default async function PostRoundPage({ params }: PageProps<"/admin/post/[round]">) {
  const { canEdit } = await requirePage("post");
  const { round: id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const supabase = await createClient();
  const [round, { data: risks }, { data: learning }] = await Promise.all([
    getPostRound(supabase, id),
    supabase.rpc("post_round_risks", { p_round: id }),
    supabase.rpc("post_risk_learning"),
  ]);
  if (!round) notFound();
  return (
    <RoundWorkspace
      round={round}
      canEdit={canEdit}
      risks={Object.fromEntries((risks ?? []).map((r) => [r.parcel_id, r.reason]))}
      learning={learning?.[0] ?? { resolved: 0, returned: 0, needed: 30 }}
    />
  );
}
