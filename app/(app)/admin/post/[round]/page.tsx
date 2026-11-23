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
  const round = await getPostRound(supabase, id);
  if (!round) notFound();
  return <RoundWorkspace round={round} canEdit={canEdit} />;
}
