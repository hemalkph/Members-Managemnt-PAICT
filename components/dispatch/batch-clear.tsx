"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clearBatchAction } from "@/lib/actions/dispatch";
import { useT } from "./lang";

/**
 * Main admins: remove a batch's student details. A batch named TEST… is wiped
 * completely (rounds, parcels, history, files); other batches only while they
 * have no sent round.
 */
export function BatchClear({ batches }: { batches: { id: string; name: string; students: number }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const batch = batches.find((b) => b.id === batchId);
  const test = Boolean(batch && /^test/i.test(batch.name));

  const clear = () =>
    startTransition(async () => {
      if (!batch) return;
      const r = await clearBatchAction({ batch_id: batch.id, confirm: typed });
      if (!r.ok) return void toast.error(t(r.error));
      toast.success(t(r.message));
      setOpen(false);
      setTyped("");
      setBatchId("");
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2Icon /> {t("Clear a batch…")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Clear a batch's student details")}</DialogTitle>
            <DialogDescription>
              {t(
                "Removes the students of one batch and their uploaded student lists. This can't be undone. The batch itself stays.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="clear-batch">{t("Batch")}</Label>
              <Select
                value={batchId}
                onValueChange={(v) => {
                  setBatchId(v);
                  setTyped("");
                }}
              >
                <SelectTrigger id="clear-batch">
                  <SelectValue placeholder={t("Choose a batch")} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} · {t("{n} students", { n: b.students })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {batch && (
              <p className="border-warning/60 bg-warning/10 rounded-md border p-3 text-sm">
                {test
                  ? t(
                      "This is a test batch: its rounds, parcels, packing and delivery history, handovers, COD settlements and uploaded files are deleted too.",
                    )
                  : t(
                      "Only possible while this batch has no sent round. Delivery and COD records of sent rounds are kept; their personal details are removed automatically later.",
                    )}
              </p>
            )}
            {batch && (
              <div className="space-y-1.5">
                <Label htmlFor="clear-confirm">{t("Type “{name}” to confirm", { name: batch.name })}</Label>
                <Input id="clear-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" onClick={clear} disabled={!batch || typed.trim() !== batch.name || pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} {t("Delete for good")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
