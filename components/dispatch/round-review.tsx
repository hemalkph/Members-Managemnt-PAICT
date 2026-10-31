"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, LockIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelRoundAction, finaliseRoundAction } from "@/lib/actions/dispatch-rounds";
import type { RoundReview } from "@/lib/dispatch/review";
import { formatLKR } from "@/lib/format";

import { useT } from "@/components/dispatch/lang";
/** The final manifest check. Finalising is blocked while any blocking problem remains. */
export function RoundReviewPanel({
  roundId,
  review,
  canEdit,
}: {
  roundId: string;
  review: RoundReview;
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const blocked = review.blocking.length > 0;

  const finalise = () =>
    startTransition(async () => {
      const result = await finaliseRoundAction({ round_id: roundId });
      setConfirm(false);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      router.refresh();
    });
  const cancelDraft = () =>
    startTransition(async () => {
      const result = await cancelRoundAction({ round_id: roundId, reason });
      setCancel(false);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      router.push("/admin/dispatch/rounds");
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Recipients", String(review.recipients)],
          ["Parcels", String(review.parcels)],
          ["COD total", formatLKR(review.codTotal)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{t(label)}</p>
            <p className="mt-1 truncate font-semibold tabular-nums">{value}</p>
          </div>
        ))}
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">{t("References")}</p>
          {review.firstReference ? (
            <p className="mt-1 font-mono text-xs leading-5 break-all">
              {review.firstReference}
              <br />
              {t("to {ref}", { ref: review.lastReference })}
            </p>
          ) : (
            <p className="mt-1 font-semibold">—</p>
          )}
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>{t("Tutes needed")}</CardTitle>
          <CardDescription>{t("Print and count these before packing.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Code")}</TableHead>
                <TableHead>{t("Tute")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("Parcels")}</TableHead>
                <TableHead className="text-right">{t("Copies")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {review.tuteTotals.map((tute) => (
                <TableRow key={tute.code}>
                  <TableCell className="font-mono">{tute.code}</TableCell>
                  <TableCell>{tute.title}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{tute.parcels}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{tute.copies}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(review.blocking.length > 0 || review.warnings.length > 0) && (
        <Card className="gap-2">
          <CardContent className="space-y-2 text-sm">
            {review.blocking.map((b) => (
              <p key={b} className="text-destructive flex gap-2">
                <XCircleIcon className="mt-0.5 size-4 shrink-0" /> {t(b)}
              </p>
            ))}
            {review.warnings.map((w) => (
              <p key={w} className="flex gap-2 text-amber-700 dark:text-warning">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> {t(w)}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {!blocked && (
        <p className="text-success flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4" /> {t("Ready to finalise.")}
        </p>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirm(true)} disabled={blocked || pending}>
            <LockIcon /> {t("Finalise round")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setCancel(true)}
            disabled={pending}
          >
            {t("Cancel draft")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Finalise {parcels} parcels?", { parcels: review.parcels })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "References, addresses, contents and COD are frozen. Later changes to students won't affect these parcels; a parcel can still be corrected (with a reason) until Citypak gives it a tracking number.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("Back")}</AlertDialogCancel>
            <Button onClick={finalise} disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />} {t("Finalise")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancel} onOpenChange={setCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Cancel this draft?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("It stays in the list as cancelled. No parcels were made.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">{t("Reason (optional)")}</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("Keep draft")}</AlertDialogCancel>
            <Button variant="destructive" onClick={cancelDraft} disabled={pending}>
              {t("Cancel draft")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
