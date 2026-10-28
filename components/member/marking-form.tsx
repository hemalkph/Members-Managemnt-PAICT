"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logMarkingAction } from "@/lib/actions/submissions";

export type MarkingPaper = { id: string; title: string; sub: string; parts: ("mcq" | "essay")[] };

type Counts = Record<string, { mcq: string; essay: string }>;

/** Pick a paper, then enter how many MCQ / Essay papers were marked at each centre. */
export function MarkingForm({
  papers,
  centres,
  canMcq,
  canEssay,
}: {
  papers: MarkingPaper[];
  centres: { id: string; name: string }[];
  canMcq: boolean;
  canEssay: boolean;
}) {
  const router = useRouter();
  const [paperId, setPaperId] = useState(papers[0]?.id ?? "");
  const [counts, setCounts] = useState<Counts>({});
  const [pending, startTransition] = useTransition();
  const paper = papers.find((p) => p.id === paperId);
  const parts = (paper?.parts ?? []).filter((p) => (p === "mcq" ? canMcq : canEssay));

  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const totals = useMemo(
    () => ({
      mcq: centres.reduce((s, c) => s + num(counts[c.id]?.mcq), 0),
      essay: centres.reduce((s, c) => s + num(counts[c.id]?.essay), 0),
    }),
    [centres, counts],
  );
  const total = parts.reduce((s, p) => s + totals[p], 0);

  const set = (centre: string, part: "mcq" | "essay", value: string) =>
    setCounts((c) => ({ ...c, [centre]: { ...(c[centre] ?? { mcq: "", essay: "" }), [part]: value } }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await logMarkingAction({
        paper_id: paperId,
        rows: centres
          .map((c) => ({
            centre_id: c.id,
            mcq: parts.includes("mcq") ? num(counts[c.id]?.mcq) : 0,
            essay: parts.includes("essay") ? num(counts[c.id]?.essay) : 0,
          }))
          .filter((r) => r.mcq > 0 || r.essay > 0),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setCounts({});
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-2">
        <Label htmlFor="marking-paper">Paper</Label>
        <Select
          value={paperId}
          onValueChange={(v) => {
            setPaperId(v);
            setCounts({});
          }}
        >
          <SelectTrigger id="marking-paper" className="w-full">
            <SelectValue placeholder="Choose the paper you marked" />
          </SelectTrigger>
          <SelectContent>
            {papers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title} · {p.sub}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {paper && parts.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          You don&apos;t have a rate for marking this kind of paper. Ask an admin.
        </p>
      ) : (
        paper && (
          <div className="overflow-hidden rounded-xl border">
            <div
              className="bg-muted/50 text-muted-foreground grid items-center gap-3 px-3 py-2 text-xs font-medium"
              style={{ gridTemplateColumns: `1fr repeat(${parts.length}, 4.75rem)` }}
            >
              <span>Centre</span>
              {parts.map((p) => (
                <span key={p} className="text-right">
                  {p === "mcq" ? "MCQ" : "Essay"}
                </span>
              ))}
            </div>
            {centres.map((c) => (
              <div
                key={c.id}
                className="grid items-center gap-3 border-t px-3 py-2"
                style={{ gridTemplateColumns: `1fr repeat(${parts.length}, 4.75rem)` }}
              >
                <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                {parts.map((p) => (
                  <Input
                    key={p}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={5000}
                    placeholder="0"
                    className="px-2 text-right"
                    aria-label={`${c.name} – ${p === "mcq" ? "MCQ" : "Essay"} papers marked`}
                    value={counts[c.id]?.[p] ?? ""}
                    onChange={(e) => set(c.id, p, e.target.value)}
                  />
                ))}
              </div>
            ))}
            <div
              className="bg-muted/30 grid items-center gap-3 border-t px-3 py-2 text-sm font-semibold"
              style={{ gridTemplateColumns: `1fr repeat(${parts.length}, 4.75rem)` }}
            >
              <span>Total</span>
              {parts.map((p) => (
                <span key={p} className="pr-3 text-right tabular-nums">
                  {totals[p]}
                </span>
              ))}
            </div>
          </div>
        )
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">Each centre is sent as its own entry. An admin approves them.</p>
        <Button type="submit" disabled={pending || !paper || total === 0}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Send {total > 0 ? `${total} marked` : ""}
        </Button>
      </div>
    </form>
  );
}
