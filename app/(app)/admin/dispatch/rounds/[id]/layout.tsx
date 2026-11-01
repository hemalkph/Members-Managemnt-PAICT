import { notFound } from "next/navigation";
import { RoundPath } from "@/components/dispatch/round-path";
import { requireDispatch } from "@/lib/dispatch/access";
import { getT } from "@/lib/dispatch/i18n/server";
import { loadRoundProgress } from "@/lib/dispatch/round-progress";
import { countsFromProgress, nextStep } from "@/lib/dispatch/rounds";
import { nextAction, roundStages, waitingFor } from "@/lib/dispatch/stages";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Every page of a round shows where the round is and the one next thing to do. */
export default async function RoundLayout({ children, params }: LayoutProps<"/admin/dispatch/rounds/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch();
  const t = await getT();
  const [round] = await loadRoundProgress(await createClient(), [id]);
  if (!round) notFound();
  const p = round.progress;
  const stages = roundStages(id, p, caps);
  const action = nextAction(id, p, caps);

  return (
    <div className="space-y-6">
      {p.state !== "cancelled" && (
        <RoundPath
          stages={stages}
          t={t}
          action={action}
          waiting={action ? null : waitingFor(stages)}
          sentence={nextStep(p.state, countsFromProgress(p), t)}
        />
      )}
      {children}
    </div>
  );
}
