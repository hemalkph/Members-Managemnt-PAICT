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
import { cn } from "@/lib/utils";

type Part = "mcq" | "essay" | "full";
const HEAD: Record<Part, string> = { full: "Full", mcq: "MCQ", essay: "Essay" };
const ARIA: Record<Part, string> = { full: "full papers", mcq: "MCQ papers", essay: "Essay papers" };

/** One paper, or a set marked together (e.g. "RFP 04" = its MCQ and SE & Essay papers). */
export type MarkingPaper = { id: string; paperIds: string[]; title: string; sub: string; parts: Part[] };

type Counts = Record<string, Partial<Record<Part, string>>>;

/**
 * Pick a paper, then enter how many papers were marked at each centre. A full
 * paper is counted whole ("Full") or by part (MCQ / Essay) – per centre, one or the other.
 */
export function MarkingForm({
  papers,
  centres,
  canMcq,
  canEssay,
  canFull,
}: {
  papers: MarkingPaper[];
  centres: { id: string; name: string }[];
  canMcq: boolean;
  canEssay: boolean;
  canFull: boolean;
}) {
  const router = useRouter();
  const [paperId, setPaperId] = useState(papers[0]?.id ?? "");
  const [counts, setCounts] = useState<Counts>({});
  const [pending, startTransition] = useTransition();
  const paper = papers.find((p) => p.id === paperId);
  const can: Record<Part, boolean> = { mcq: canMcq, essay: canEssay, full: canFull };
  const parts = (paper?.parts ?? []).filter((p) => can[p]);

  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const totals = useMemo(
    () => ({
      mcq: centres.reduce((s, c) => s + num(counts[c.id]?.mcq), 0),
      essay: centres.reduce((s, c) => s + num(counts[c.id]?.essay), 0),
      full: centres.reduce((s, c) => s + num(counts[c.id]?.full), 0),
    }),
    [centres, counts],
  );
  const total = parts.reduce((s, p) => s + totals[p], 0);

  const set = (centre: string, part: Part, value: string) =>
    setCounts((c) => ({ ...c, [centre]: { ...c[centre], [part]: value } }));
  // A centre with full papers can't also have MCQ / Essay counts, and the other way round.
  const locked = (centre: string, part: Part) => {
    const row = counts[centre] ?? {};
    return part === "full" ? num(row.mcq) > 0 || num(row.essay) > 0 : num(row.full) > 0;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await logMarkingAction({
        paper_ids: paper?.paperIds ?? [],
        rows: centres
          .map((c) => ({
            centre_id: c.id,
            mcq: parts.includes("mcq") && !locked(c.id, "mcq") ? num(counts[c.id]?.mcq) : 0,
            essay: parts.includes("essay") && !locked(c.id, "essay") ? num(counts[c.id]?.essay) : 0,
            full: parts.includes("full") && !locked(c.id, "full") ? num(counts[c.id]?.full) : 0,
          }))
          .filter((r) => r.mcq > 0 || r.essay > 0 || r.full > 0),
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
        <Label htmlFor="marking-paper">RFP / paper</Label>
        <Select
          value={paperId}
          onValueChange={(v) => {
            setPaperId(v);
            setCounts({});
          }}
        >
          <SelectTrigger id="marking-paper" className="w-full">
            <SelectValue placeholder="Choose the RFP / paper you marked" />
          </SelectTrigger>
          <SelectContent>
            {papers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
                {p.sub ? ` · ${p.sub}` : ""}
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
                  {HEAD[p]}
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
                    className={cn("px-2 text-right", p === "full" && "border-primary/40")}
                    disabled={locked(c.id, p)}
                    title={
                      locked(c.id, p)
                        ? p === "full"
                          ? "Clear MCQ and Essay to enter full papers"
                          : "Clear Full to enter MCQ / Essay"
                        : undefined
                    }
                    aria-label={`${c.name} – ${ARIA[p]} marked`}
                    value={locked(c.id, p) ? "" : (counts[c.id]?.[p] ?? "")}
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
      {parts.includes("full") && (
        <p className="text-muted-foreground -mt-2 text-xs">
          <strong className="text-foreground">Full</strong> = one student&apos;s MCQ + Essay, both marked by you. For
          each centre, enter full papers <em>or</em> MCQ / Essay – the other boxes lock.
        </p>
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
