"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { SaveIcon, SearchIcon, UndoIcon } from "lucide-react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveResultsAction } from "@/lib/actions/student-results";
import { ATTENDANCE_LABEL, CARD_LABEL, LOW_PERCENT, resultTotal, type Attendance } from "@/lib/students/rules";
import type { ExamPart, SheetRow } from "@/lib/students/results";
import { cn } from "@/lib/utils";

type Draft = { attendance: Attendance | null; note: string; marks: Record<string, string> };

const toDraft = (r: SheetRow): Draft => ({
  attendance: r.attendance,
  note: r.note,
  marks: Object.fromEntries(Object.entries(r.marks).map(([k, v]) => [k, String(v)])),
});
const same = (a: Draft, b: Draft, parts: ExamPart[]) =>
  a.attendance === b.attendance &&
  a.note.trim() === b.note.trim() &&
  parts.every((p) => (a.marks[p.id] ?? "").trim() === (b.marks[p.id] ?? "").trim());

const ATTENDANCE_SHORT: Record<Attendance, string> = { present: "P", absent: "A", excused: "E" };

/**
 * The marks grid for one exam. Type a mark and the student is marked present;
 * click the selected P / A / E again to clear it. Only changed rows are saved.
 */
export function ResultsSheet({
  examId,
  parts,
  rows,
  centres,
  canEdit,
}: {
  examId: string;
  parts: ExamPart[];
  rows: SheetRow[];
  centres: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const saved = useMemo(() => new Map(rows.map((r) => [r.studentId, toDraft(r)])), [rows]);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map(saved));
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();

  // A student added after the page opened starts from what is saved.
  const draftOf = (id: string) => drafts.get(id) ?? saved.get(id)!;
  const changed = rows.filter((r) => !same(draftOf(r.studentId), saved.get(r.studentId)!, parts));
  const update = (id: string, change: (d: Draft) => Draft) =>
    setDrafts((m) => new Map(m).set(id, change(m.get(id) ?? saved.get(id)!)));

  const setMark = (id: string, part: string, value: string) =>
    update(id, (d) => ({ ...d, attendance: d.attendance ?? (value.trim() ? "present" : null), marks: { ...d.marks, [part]: value } }));

  const visible = rows.filter(
    (r) => !q || r.fullName.toLowerCase().includes(q.toLowerCase()) || r.studentNo.toLowerCase().includes(q.toLowerCase()),
  );
  const counts = rows.reduce(
    (c, r) => {
      const a = draftOf(r.studentId).attendance;
      c[a ?? "none"] += 1;
      return c;
    },
    { present: 0, absent: 0, excused: 0, none: 0 },
  );

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = changed.find((r) => {
      const d = draftOf(r.studentId);
      return d.attendance === "present" && parts.some((p) => Number(d.marks[p.id]) > p.maxMarks);
    });
    if (bad) return toast.error(`${bad.fullName}: a mark is above the full marks.`);
    startTransition(async () => {
      const result = await saveResultsAction({
        exam_id: examId,
        rows: changed.map((r) => {
          const d = draftOf(r.studentId);
          return {
            student_id: r.studentId,
            attendance: d.attendance,
            note: d.note,
            marks: d.attendance === "present" ? Object.fromEntries(parts.map((p) => [p.id, (d.marks[p.id] ?? "").trim()])) : {},
          };
        }),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No concession students in this batch yet.</p>;
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" className="pl-9" aria-label="Find a student" />
        </div>
        <p className="text-muted-foreground text-sm">
          {counts.present} present · {counts.absent} absent · {counts.excused} excused
          {counts.none > 0 && ` · ${counts.none} not marked`}
        </p>
      </div>

      <Card className="overflow-x-auto py-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-[11px] tracking-wide uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Student</th>
              <th className="px-2 py-2 text-left font-semibold">Attendance</th>
              {parts.map((p) => (
                <th key={p.id} className="px-2 py-2 text-left font-semibold">
                  {p.name} <span className="font-normal normal-case">/ {p.maxMarks}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = draftOf(r.studentId);
              const present = d.attendance === "present";
              const numbers = Object.fromEntries(
                parts.map((p) => [p.id, d.marks[p.id]?.trim() ? Number(d.marks[p.id]) : null]),
              );
              const t = present ? resultTotal(parts, numbers) : null;
              const dirty = !same(d, saved.get(r.studentId)!, parts);
              return (
                <tr
                  key={r.studentId}
                  className={cn("border-t", d.attendance === "absent" && "bg-destructive/5", dirty && "bg-primary/5")}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.fullName}</p>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                      {r.studentNo}
                      {r.centreId && centres[r.centreId] && ` · ${centres[r.centreId]}`}
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {CARD_LABEL[r.card]}
                      </Badge>
                    </p>
                  </td>
                  <td className="px-2 py-2">
                    <div className="inline-flex rounded-md border" role="radiogroup" aria-label={`Attendance of ${r.fullName}`}>
                      {(Object.keys(ATTENDANCE_SHORT) as Attendance[]).map((a) => (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={d.attendance === a}
                          title={ATTENDANCE_LABEL[a]}
                          aria-label={ATTENDANCE_LABEL[a]}
                          disabled={!canEdit}
                          onClick={() => update(r.studentId, (x) => ({ ...x, attendance: x.attendance === a ? null : a }))}
                          className={cn(
                            "w-8 py-1 text-xs font-semibold first:rounded-l-md last:rounded-r-md disabled:cursor-default",
                            d.attendance === a
                              ? a === "present"
                                ? "bg-success text-white"
                                : a === "absent"
                                  ? "bg-destructive text-white"
                                  : "bg-muted-foreground text-white"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {ATTENDANCE_SHORT[a]}
                        </button>
                      ))}
                    </div>
                    {d.attendance !== null && !present && (
                      <Input
                        aria-label={`Reason ${r.fullName} was ${ATTENDANCE_LABEL[d.attendance].toLowerCase()}`}
                        placeholder="Reason (optional)"
                        maxLength={300}
                        className="mt-1 h-7 w-full max-w-48 text-xs"
                        disabled={!canEdit}
                        value={d.note}
                        onChange={(e) => update(r.studentId, (x) => ({ ...x, note: e.target.value }))}
                      />
                    )}
                  </td>
                  {parts.map((p) => {
                    const v = d.marks[p.id] ?? "";
                    const over = v.trim() !== "" && (Number.isNaN(Number(v)) || Number(v) > p.maxMarks);
                    return (
                      <td key={p.id} className="px-2 py-2">
                        <Input
                          aria-label={`${p.name} marks of ${r.fullName}`}
                          inputMode="decimal"
                          className={cn("h-8 w-20", over && "border-destructive")}
                          disabled={!canEdit || (d.attendance !== null && !present)}
                          value={present || d.attendance === null ? v : ""}
                          onChange={(e) => setMark(r.studentId, p.id, e.target.value)}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t?.total !== null && t?.total !== undefined ? (
                      <>
                        <span className="font-medium">{t.total}</span>
                        <span className="text-muted-foreground"> / {t.max}</span>
                        <span
                          className={cn(
                            "block text-xs",
                            t.percent !== null && t.percent < LOW_PERCENT ? "text-destructive font-medium" : "text-muted-foreground",
                          )}
                        >
                          {t.percent}%{!t.complete && " · part missing"}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{d.attendance && !present ? ATTENDANCE_LABEL[d.attendance] : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {canEdit && (
        <div className="bg-background/95 sticky bottom-0 flex items-center justify-end gap-2 border-t py-3 backdrop-blur">
          <span className="text-muted-foreground mr-auto text-sm">
            {changed.length === 0 ? "No changes" : `${changed.length} student${changed.length === 1 ? "" : "s"} changed`}
          </span>
          <Button type="button" variant="ghost" disabled={changed.length === 0 || pending} onClick={() => setDrafts(new Map(saved))}>
            <UndoIcon /> Undo
          </Button>
          <SubmitButton pending={pending} disabled={changed.length === 0}>
            <SaveIcon /> Save
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
