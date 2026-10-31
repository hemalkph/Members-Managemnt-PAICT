import { notFound } from "next/navigation";
import { RoundPath } from "@/components/dispatch/round-path";
import { requireDispatch } from "@/lib/dispatch/access";
import { getT } from "@/lib/dispatch/i18n/server";
import { loadRoundProgress } from "@/lib/dispatch/round-progress";
import { nextStep } from "@/lib/dispatch/rounds";
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
          sentence={nextStep(
            p.state,
            {
              parcels: p.live,
              registered: p.registered,
              voided: 0,
              packed: p.packed,
              verified: p.verified,
              onHold: p.onHold,
              handedOver: p.handedOver,
              delivered: p.delivered,
              returned: p.returned,
              problems: p.failed,
              codOwing: p.codOwing,
              canClose:
                p.live > 0 &&
                p.handedOver >= p.live &&
                p.delivered + p.returned >= p.live &&
                p.codOwing <= 0 &&
                p.inDraft === 0,
            },
            t,
          )}
        />
      )}
      {children}
    </div>
  );
}
