"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setRoundStudentsAction } from "@/lib/actions/dispatch-rounds";

export type PickStudent = { id: string; no: string; name: string; city: string; problems: string[] };
export type ChosenSettings = { cod_amount: number | null; note: string; excluded_tute_ids: string[] };

/** Choose exactly which students get a parcel. Nobody is added just because their number is in a range. */
export function RoundStudentsPicker({
  roundId,
  students,
  chosen,
}: {
  roundId: string;
  students: PickStudent[];
  chosen: Record<string, ChosenSettings>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(Object.keys(chosen)));
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? students.filter((x) => x.no.toLowerCase().includes(s) || x.name.toLowerCase().includes(s)) : students;
  }, [q, students]);
  const complete = students.filter((s) => s.problems.length === 0);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const rows = students
        .filter((s) => selected.has(s.id))
        .map((s) => ({
          student_id: s.id,
          cod_amount: chosen[s.id]?.cod_amount ?? ("" as const),
          note: chosen[s.id]?.note ?? "",
          excluded_tute_ids: chosen[s.id]?.excluded_tute_ids ?? [],
        }));
      const result = await setRoundStudentsAction({ round_id: roundId, rows });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number or name" className="pl-9" aria-label="Search students" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(complete.map((s) => s.id)))}>
            Select all with complete details ({complete.length})
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      </div>

      <Card className="max-h-[60vh] overflow-y-auto py-0">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-10 pl-4">
                <span className="sr-only">In round</span>
              </TableHead>
              <TableHead>No.</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">City</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={s.id} data-state={selected.has(s.id) ? "selected" : undefined}>
                <TableCell className="pl-4">
                  <Checkbox checked={selected.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} aria-label={`Include ${s.no}`} />
                </TableCell>
                <TableCell className="font-mono text-sm">{s.no}</TableCell>
                <TableCell className="max-w-[180px] truncate">{s.name}</TableCell>
                <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">{s.city || "—"}</TableCell>
                <TableCell>
                  {s.problems.length === 0 ? (
                    <span className="text-muted-foreground text-xs">Complete</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {s.problems.map((p) => (
                        <Badge key={p} variant="warning">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                  No students match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />} Save {selected.size} student{selected.size === 1 ? "" : "s"}
        </Button>
        <p className="text-muted-foreground text-sm">Students with missing details can be chosen now but block finalising until fixed.</p>
      </div>
    </div>
  );
}
