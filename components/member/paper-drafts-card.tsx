"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileClockIcon, Loader2Icon, PencilLineIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import AnimatedList from "@/components/reactbits/animated-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { logPaperPagesAction } from "@/lib/actions/submissions";
import { formatLKR } from "@/lib/format";

export type DraftItem = {
  taskId: string;
  title: string;
  stageLabel: string;
  /** Pre-formatted on the server. */
  doneOn: string | null;
  rateLabel: string | null;
  price: number | null;
};

function DraftRow({ draft, showMoney }: { draft: DraftItem; showMoney: boolean }) {
  const router = useRouter();
  const [pages, setPages] = useState("");
  const [pending, startTransition] = useTransition();
  const count = Number(pages);
  const valid = Number.isInteger(count) && count >= 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      toast.error("Enter the number of pages");
      return;
    }
    startTransition(async () => {
      const result = await logPaperPagesAction({ task_id: draft.taskId, pages: count });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">Draft</Badge>
          <p className="truncate text-sm font-medium">{draft.title}</p>
        </div>
        <p className="text-muted-foreground text-xs">
          {draft.stageLabel}
          {draft.doneOn && ` · done ${draft.doneOn}`}
          {draft.rateLabel && ` · ${draft.rateLabel}`}
          {showMoney && draft.price !== null && valid && (
            <span className="text-foreground font-medium"> · {formatLKR(draft.price * count)}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {draft.rateLabel ? (
          <>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={2000}
              placeholder="Pages"
              aria-label={`Pages for ${draft.title}`}
              className="w-24"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
            />
            <Button type="submit" disabled={pending || !valid}>
              {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              Submit
            </Button>
          </>
        ) : (
          <Button asChild variant="outline">
            <Link href={`/work/new?task=${draft.taskId}`}>
              <PencilLineIcon /> Fill in
            </Link>
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Finished type setting / conversion stages, ready to log: the member only adds
 * the number of pages.
 */
export function PaperDraftsCard({ drafts, showMoney }: { drafts: DraftItem[]; showMoney: boolean }) {
  if (drafts.length === 0) return null;
  return (
    <Card className="border-primary/30 gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileClockIcon className="text-primary size-5" /> Ready to log
          <Badge>{drafts.length}</Badge>
        </CardTitle>
        <CardDescription>
          Paper work you finished. Add the number of pages and submit – everything else is filled in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AnimatedList
          items={drafts.map((d) => ({ key: d.taskId, node: <DraftRow draft={d} showMoney={showMoney} /> }))}
        />
      </CardContent>
    </Card>
  );
}
