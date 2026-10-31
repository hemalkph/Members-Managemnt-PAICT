"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setRoundStudentsAction } from "@/lib/actions/dispatch-rounds";
import { formatLKR } from "@/lib/format";

import { useT } from "@/components/dispatch/lang";
export type MatrixRow = { student_id: string; no: string; name: string; cod: string; note: string; excluded: string[] };

/** Students × tutes: what each parcel holds, plus each student's COD. */
export function ContentsMatrix({
  roundId,
  defaultCod,
  tutes,
  initial,
}: {
  roundId: string;
  defaultCod: number;
  tutes: { id: string; code: string; title: string }[];
  initial: MatrixRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();

  const has = (r: MatrixRow, t: string) => !r.excluded.includes(t);
  const set = (studentId: string, tuteId: string, on: boolean) =>
    setRows((rs) =>
      rs.map((r) =>
        r.student_id !== studentId
          ? r
          : { ...r, excluded: on ? r.excluded.filter((x) => x !== tuteId) : [...r.excluded, tuteId] },
      ),
    );
  const column = (tuteId: string, on: boolean) =>
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        excluded: on ? r.excluded.filter((x) => x !== tuteId) : [...new Set([...r.excluded, tuteId])],
      })),
    );
  const codTotal = rows.reduce((sum, r) => sum + (r.cod === "" ? defaultCod : Number(r.cod) || 0), 0);

  const save = () =>
    startTransition(async () => {
      const result = await setRoundStudentsAction({
        round_id: roundId,
        rows: rows.map((r) => ({
          student_id: r.student_id,
          cod_amount: r.cod,
          note: r.note,
          excluded_tute_ids: r.excluded,
        })),
      });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t("Contents saved"));
      router.refresh();
    });

  if (tutes.length === 0 || rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("Add tutes and choose students first.")}</p>;
  }

  return (
    <div className="space-y-4">
      <Card className="max-h-[65vh] overflow-auto py-0">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="bg-background sticky left-0 z-20 pl-4">{t("Student")}</TableHead>
              {tutes.map((tute) => {
                const all = rows.every((r) => has(r, tute.id));
                return (
                  <TableHead key={tute.id} className="text-center" title={tute.title}>
                    <div className="flex flex-col items-center gap-1 py-1">
                      <span className="font-mono">{tute.code}</span>
                      <Checkbox
                        checked={all}
                        onCheckedChange={(v) => column(tute.id, v === true)}
                        aria-label={t("Everyone gets {code}", { code: tute.code })}
                      />
                    </div>
                  </TableHead>
                );
              })}
              <TableHead className="w-36">{t("COD (Rs.)")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.student_id}>
                <TableCell className="bg-background sticky left-0 pl-4">
                  <p className="font-mono text-sm">{r.no}</p>
                  <p className="text-muted-foreground max-w-[140px] truncate text-xs">{r.name}</p>
                </TableCell>
                {tutes.map((tute) => (
                  <TableCell key={tute.id} className="text-center">
                    <Checkbox
                      checked={has(r, tute.id)}
                      onCheckedChange={(v) => set(r.student_id, tute.id, v === true)}
                      aria-label={`${r.no} gets ${tute.code}`}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={r.cod}
                    placeholder={`${defaultCod} (default)`}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x) => (x.student_id === r.student_id ? { ...x, cod: e.target.value } : x)),
                      )
                    }
                    className="h-8"
                    aria-label={t("COD for {no}", { no: r.no })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4 font-medium">{t("{length} parcels", { length: rows.length })}</TableCell>
              {tutes.map((tute) => (
                <TableCell key={tute.id} className="text-center tabular-nums">
                  {rows.filter((r) => has(r, tute.id)).length}
                </TableCell>
              ))}
              <TableCell className="tabular-nums">{formatLKR(codTotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />} {t("Save contents")}
        </Button>
        <p className="text-muted-foreground text-sm">
          {t("An empty COD box uses the round's default ({amount}).", { amount: formatLKR(defaultCod) })}
        </p>
      </div>
    </div>
  );
}
