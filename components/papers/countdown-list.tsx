import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/core/format";
import { PRE_EXAM_STAGES, STAGE_LABEL } from "@/lib/papers";
import type { CountdownRow, PaperState } from "@/lib/papers/countdown";
import { cn } from "@/lib/utils";

const STATE: Record<PaperState, { label: string; variant: "destructive" | "warning" | "secondary" | "success" }> = {
  late: { label: "Late", variant: "destructive" },
  at_risk: { label: "At risk", variant: "warning" },
  on_track: { label: "On track", variant: "secondary" },
  ready: { label: "Ready", variant: "success" },
};

const daysUntil = (today: string, day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

function when(today: string, day: string) {
  const n = daysUntil(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} ago`;
  return `in ${n} days`;
}

/** Papers grouped by exam day: state, stage chips, why, and who to message. */
export function CountdownList({
  rows,
  today,
  whatsapp,
}: {
  rows: CountdownRow[];
  today: string;
  whatsapp: Record<string, string>;
}) {
  const groups = new Map<string, CountdownRow[]>();
  for (const r of rows) groups.set(r.examDay, [...(groups.get(r.examDay) ?? []), r]);
  // Keep the urgent-first order of the rows for the groups.
  const order = [...new Set(rows.map((r) => r.examDay))];

  return (
    <div className="space-y-6">
      {order.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-semibold">
            Exam {formatDay(day)} <span className="text-muted-foreground font-normal">· {when(today, day)}</span>
          </h2>
          <ul className="divide-y rounded-xl border">
            {groups.get(day)!.map((r) => {
              const meta = STATE[r.state];
              const owner = r.blocking?.ownerId ?? null;
              const phone = owner ? whatsapp[owner] : undefined;
              const stages = r.paper.stages
                .filter((s) => PRE_EXAM_STAGES.includes(s.stage) && s.status !== "skipped")
                .sort((a, b) => a.position - b.position);
              return (
                <li key={r.paper.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/papers/${r.paper.id}`} className="min-w-0 font-medium hover:underline">
                      {r.paper.title}
                      {r.paper.examLabel && (
                        <span className="text-muted-foreground font-normal"> · {r.paper.examLabel}</span>
                      )}
                    </Link>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {stages.map((s) => (
                      <Badge
                        key={s.id}
                        variant={
                          s.status === "done"
                            ? "success"
                            : s.status === "in_progress"
                              ? s.overdue
                                ? "destructive"
                                : "warning"
                              : "outline"
                        }
                        className={cn("font-normal", s.status === "waiting" && "text-muted-foreground")}
                      >
                        {STAGE_LABEL[s.stage]}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span>{r.reason}</span>
                    {r.state !== "ready" && r.state !== "on_track" && r.blocking?.ownerName && (
                      <span>· {r.blocking.ownerName}</span>
                    )}
                    {r.state !== "ready" && r.state !== "on_track" && phone && (
                      <a
                        href={`https://wa.me/${phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        <MessageCircleIcon className="size-3.5" /> Message
                      </a>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
