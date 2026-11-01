"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2Icon, SearchIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setRoundStudentsAction } from "@/lib/actions/dispatch-rounds";
import { formatLKR } from "@/lib/format";
import { gets } from "@/lib/dispatch/review";
import { cn } from "@/lib/utils";

import { useT } from "@/components/dispatch/lang";
export type MatrixRow = {
  student_id: string;
  no: string;
  name: string;
  cod: string;
  note: string;
  excluded: string[];
  extra: string[];
};
type MatrixTute = { id: string; code: string; title: string; extra: boolean };

/** Students × tutes: what each parcel holds, plus each student's COD. */
export function ContentsMatrix({
  roundId,
  defaultCod,
  tutes,
  initial,
}: {
  roundId: string;
  defaultCod: number;
  tutes: MatrixTute[];
  initial: MatrixRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.no.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)) : rows;
  }, [q, rows]);

  const has = (r: MatrixRow, tute: MatrixTute) => gets(r, tute);
  // Normal tutes: unticking adds to "excluded". Extra tutes: ticking adds to "extra".
  const toggle = (r: MatrixRow, tute: MatrixTute, on: boolean): MatrixRow => {
    const key = tute.extra ? "extra" : "excluded";
    const add = tute.extra ? on : !on;
    return { ...r, [key]: add ? [...new Set([...r[key], tute.id])] : r[key].filter((x) => x !== tute.id) };
  };
  const set = (studentId: string, tute: MatrixTute, on: boolean) =>
    setRows((rs) => rs.map((r) => (r.student_id === studentId ? toggle(r, tute, on) : r)));
  // The header box changes only the students shown (so a search + tick-all picks a group).
  const column = (tute: MatrixTute, on: boolean) => {
    const ids = new Set(shown.map((r) => r.student_id));
    setRows((rs) => rs.map((r) => (ids.has(r.student_id) ? toggle(r, tute, on) : r)));
  };
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
          extra_tute_ids: r.extra,
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search number or name")}
            className="pl-9"
            aria-label={t("Search students")}
          />
        </div>
        {tutes.some((tute) => tute.extra) && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <SparklesIcon className="size-4 text-amber-600" />
            {t("Extra tutes go only to the students you tick.")}
          </p>
        )}
      </div>
      <Card className="max-h-[65vh] overflow-auto py-0 shadow-sm">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="bg-background sticky left-0 z-20 pl-4">{t("Student")}</TableHead>
              {tutes.map((tute) => {
                const all = shown.length > 0 && shown.every((r) => has(r, tute));
                return (
                  <TableHead
                    key={tute.id}
                    className={cn("text-center", tute.extra && "bg-amber-50 dark:bg-amber-950/30")}
                    title={tute.title}
                  >
                    <div className="flex flex-col items-center gap-1 py-1">
                      <span className="inline-flex items-center gap-1 font-mono">
                        {tute.extra && <SparklesIcon className="size-3 text-amber-600" aria-label={t("Extra")} />}
                        {tute.code}
                      </span>
                      <Checkbox
                        checked={all}
                        onCheckedChange={(v) => column(tute, v === true)}
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
            {shown.map((r) => (
              <TableRow key={r.student_id}>
                <TableCell className="bg-background sticky left-0 pl-4">
                  <p className="font-mono text-sm">{r.no}</p>
                  <p className="text-muted-foreground max-w-[140px] truncate text-xs">{r.name}</p>
                </TableCell>
                {tutes.map((tute) => (
                  <TableCell key={tute.id} className={cn("text-center", tute.extra && "bg-amber-50/60 dark:bg-amber-950/20")}>
                    <Checkbox
                      checked={has(r, tute)}
                      onCheckedChange={(v) => set(r.student_id, tute, v === true)}
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
                  {rows.filter((r) => has(r, tute)).length}
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
