"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2Icon, LockIcon, LockOpenIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { closeRoundAction, reopenRoundAction } from "@/lib/actions/dispatch-money";
import { formatDateTime, formatLKR } from "@/lib/format";

import { useT } from "@/components/dispatch/lang";
export type CloseCheck = {
  state: string;
  live: number;
  handed_over: number;
  delivered: number;
  returned: number;
  unresolved: number;
  cod_expected: number;
  cod_paid: number;
  cod_written_off: number;
  cod_outstanding: number;
  open_exceptions: number;
  blockers: string[];
  can_close: boolean;
  closed_at: string | null;
  closed_name: string | null;
  close_note: string | null;
};

/** The round's closing summary: what happened, what blocks closing, and close / reopen. */
export function RoundClosePanel({
  roundId,
  check,
  canClose,
  canReopen,
}: {
  roundId: string;
  check: CloseCheck;
  canClose: boolean;
  canReopen: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState<"close" | "reopen" | null>(null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const closed = check.state === "closed";

  const submit = () =>
    startTransition(async () => {
      const r =
        open === "close"
          ? await closeRoundAction({ round_id: roundId, note: text })
          : await reopenRoundAction({ round_id: roundId, reason: text });
      if (!r.ok) return void toast.error(t(r.error));
      toast.success(t(r.message));
      setOpen(null);
      setText("");
      router.refresh();
    });

  const facts: [string, string][] = [
    ["Handed over", t("{n} of {total}", { n: check.handed_over, total: check.live })],
    ["Delivered", String(check.delivered)],
    ["Returned", String(check.returned)],
    ["Not finished", String(check.unresolved)],
    ["COD expected", formatLKR(Number(check.cod_expected))],
    ["COD received", formatLKR(Number(check.cod_paid))],
    ["Written off", formatLKR(Number(check.cod_written_off))],
    ["Open problems", String(check.open_exceptions)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {closed ? <LockIcon className="size-4" /> : null} {closed ? t("Round closed") : t("Close the round")}
        </CardTitle>
        <CardDescription>
          {closed
            ? `${t("Closed {when}", { when: formatDateTime(check.closed_at) })}${check.closed_name ? ` ${t("by {name}", { name: check.closed_name })}` : ""}${check.close_note ? ` – ${check.close_note}` : ""}. ${t("It is read-only now.")}`
            : t(
                "A round closes when every parcel is delivered or returned and its COD is settled. Open problem reports stay visible after closing.",
              )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground text-xs">{t(k)}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {!closed && (
          <ul className="space-y-1 text-sm">
            {check.blockers.length === 0 ? (
              <li className="text-success flex items-center gap-2">
                <CheckCircle2Icon className="size-4" /> {t("Ready to close.")}
              </li>
            ) : (
              check.blockers.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <XCircleIcon className="text-destructive mt-0.5 size-4 shrink-0" /> {t(b)}
                </li>
              ))
            )}
          </ul>
        )}
        {!closed && canClose && (
          <Button onClick={() => setOpen("close")} disabled={!check.can_close}>
            <LockIcon /> {t("Close round")}
          </Button>
        )}
        {closed && canReopen && (
          <Button variant="outline" onClick={() => setOpen("reopen")}>
            <LockOpenIcon /> {t("Reopen…")}
          </Button>
        )}
      </CardContent>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open === "close" ? t("Close this round?") : t("Reopen this round?")}</DialogTitle>
            <DialogDescription>
              {open === "close"
                ? t(
                    "Nothing in it can be changed after closing. Personal details are removed later under the retention settings.",
                  )
                : t("Only do this to correct something. The reason is recorded.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="close-text">{open === "close" ? t("Note (optional)") : t("Reason")}</Label>
            <Input
              id="close-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={open === "close" ? 500 : 300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t("Back")}
            </Button>
            <Button onClick={submit} disabled={pending || (open === "reopen" && text.trim().length < 3)}>
              {open === "close" ? t("Close round") : t("Reopen round")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
