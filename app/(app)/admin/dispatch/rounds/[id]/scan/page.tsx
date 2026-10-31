import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { ScanStation } from "@/components/dispatch/scan-station";
import { Button } from "@/components/ui/button";
import { roundProgressAction } from "@/lib/actions/dispatch-packing";
import { requireDispatch } from "@/lib/dispatch/access";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Packing station – Tute dispatch" };

export default async function ScanPage({ params }: PageProps<"/admin/dispatch/rounds/[id]/scan">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch(["pack", "verify"]);
  const supabase = await createClient();
  const [{ data: round }, { data: settings }, progress] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").eq("id", id).maybeSingle(),
    supabase.from("dispatch_settings").select("require_verification").limit(1).maybeSingle(),
    roundProgressAction({ round_id: id }),
  ]);
  if (!round) notFound();
  const open = round.state === "finalised" || round.state === "active";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Packing station</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/dispatch/rounds/${id}`}>
            <ArrowLeftIcon /> Round
          </Link>
        </Button>
      </div>
      {open ? (
        <ScanStation
          roundId={id}
          roundName={round.name}
          canPack={caps.has("pack")}
          canVerify={caps.has("verify")}
          verificationOn={Boolean(settings?.require_verification)}
          initialProgress={progress.ok && progress.data ? progress.data : { total: 0, registered: 0, packed: 0, verified: 0, onHold: 0, mine: 0 }}
        />
      ) : (
        <p className="text-muted-foreground text-sm">This round is not open for packing.</p>
      )}
    </div>
  );
}
