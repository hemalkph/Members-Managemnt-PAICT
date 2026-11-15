import { Badge } from "@/components/ui/badge";
import { formatDate, formatLKR } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import type { TimelineExam, TimelineMonth } from "@/lib/students/analysis";
import { ATTENDANCE_LABEL, LOW_PERCENT } from "@/lib/students/rules";
import { cn } from "@/lib/utils";

/** One row per month (newest first): exams sat, absences, average % and payment. */
export function MonthTimeline({ months, showPayments }: { months: TimelineMonth[]; showPayments: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="text-muted-foreground text-[11px] tracking-wide uppercase">
          <tr className="border-b">
            <th className="py-2 pr-2 text-left font-semibold">Month</th>
            <th className="px-2 py-2 text-left font-semibold">Exams</th>
            <th className="px-2 py-2 text-right font-semibold">Average</th>
            {showPayments && <th className="py-2 pl-2 text-right font-semibold">Payment</th>}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className={cn("border-b last:border-0", m.absent > 0 && "bg-destructive/5")}>
              <td className="py-2 pr-2 whitespace-nowrap">{monthLabel(m.month, "short")}</td>
              <td className="px-2 py-2">
                {m.held === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1">
                    <span>
                      {m.present}/{m.held} sat
                    </span>
                    {m.absent > 0 && <Badge variant="destructive">{m.absent} absent</Badge>}
                    {m.excused > 0 && <Badge variant="secondary">{m.excused} excused</Badge>}
                  </span>
                )}
              </td>
              <td
                className={cn(
                  "px-2 py-2 text-right tabular-nums",
                  m.averagePercent !== null && m.averagePercent < LOW_PERCENT && "text-destructive font-medium",
                )}
              >
                {m.averagePercent === null ? "—" : `${m.averagePercent}%`}
              </td>
              {showPayments && (
                <td className="py-2 pl-2 text-right">
                  {m.payment === "paid" ? (
                    <Badge variant="success">{m.amount !== null ? formatLKR(m.amount) : "Paid"}</Badge>
                  ) : m.payment === "unpaid" ? (
                    <Badge variant="destructive">Unpaid</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each exam of the last 12 months with the student's result, newest first. */
export function ExamResultsList({ exams }: { exams: TimelineExam[] }) {
  if (exams.length === 0) return <p className="text-muted-foreground text-sm">No exams with a date in the last 12 months.</p>;
  return (
    <ul className="divide-y">
      {exams.map((e) => (
        <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{e.name}</p>
            <p className="text-muted-foreground text-xs">{formatDate(e.date)}</p>
          </div>
          {e.attendance === null ? (
            <span className="text-muted-foreground text-xs">No result</span>
          ) : e.attendance !== "present" ? (
            <Badge variant={e.attendance === "absent" ? "destructive" : "secondary"}>{ATTENDANCE_LABEL[e.attendance]}</Badge>
          ) : (
            <span className="text-right tabular-nums">
              {e.total !== null ? `${e.total} / ${e.max}` : "—"}
              {e.percent !== null && (
                <span className={cn("block text-xs", e.percent < LOW_PERCENT ? "text-destructive font-medium" : "text-muted-foreground")}>
                  {e.percent}%
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
