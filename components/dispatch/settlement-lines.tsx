"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, ListPlusIcon, Loader2Icon, PaperclipIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  addSettlementLinesAction,
  attachSettlementFileAction,
  cancelSettlementAction,
  confirmSettlementAction,
  removeSettlementLineAction,
  setSettlementLineAction,
} from "@/lib/actions/dispatch-money";
import { DELIVERY, type DeliveryState } from "@/lib/dispatch/delivery";
import { formatLKR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type SettlementLine = {
  id: string;
  reference: string;
  trackingNo: string | null;
  roundName: string;
  deliveryState: DeliveryState;
  codExpected: number;
  collected: number;
  fee: number;
};

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function SettlementLines({
  settlementId,
  state,
  remitted,
  lines,
  fileId,
  canCancelConfirmed,
}: {
  settlementId: string;
  state: "draft" | "confirmed" | "cancelled";
  remitted: number;
  lines: SettlementLine[];
  fileId: string | null;
  canCancelConfirmed: boolean;
}) {
  const router = useRouter();
  const draft = state === "draft";
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<{ code: string; message: string }[]>([]);
  const [edits, setEdits] = useState<Record<string, { collected: string; fee: string }>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dispute, setDispute] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [pending, startTransition] = useTransition();

  const collected = lines.reduce((s, l) => s + l.collected, 0);
  const fees = lines.reduce((s, l) => s + l.fee, 0);
  const net = Math.round((collected - fees) * 100) / 100;
  const diff = Math.round((remitted - net) * 100) / 100;

  const add = () =>
    startTransition(async () => {
      const r = await addSettlementLinesAction({ settlement_id: settlementId, text });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setProblems(r.data!.problems);
      if (r.data!.added > 0) setText("");
      router.refresh();
    });

  const saveLine = (l: SettlementLine) =>
    startTransition(async () => {
      const e = edits[l.id];
      if (!e) return;
      const r = await setSettlementLineAction({ settlement_id: settlementId, line_id: l.id, collected: Number(e.collected || 0), fee: Number(e.fee || 0) });
      if (!r.ok) return void toast.error(r.error);
      setEdits((all) => {
        const rest = { ...all };
        delete rest[l.id];
        return rest;
      });
      router.refresh();
    });

  const remove = (l: SettlementLine) =>
    startTransition(async () => {
      const r = await removeSettlementLineAction({ settlement_id: settlementId, line_id: l.id });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });

  const confirm = () =>
    startTransition(async () => {
      const r = await confirmSettlementAction({ settlement_id: settlementId, dispute_note: dispute });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setConfirmOpen(false);
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelSettlementAction({ settlement_id: settlementId, reason: cancelReason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setCancelOpen(false);
      router.refresh();
    });

  const attach = (file: File | null) =>
    startTransition(async () => {
      if (!file) return;
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      if (!FILE_TYPES[ext]) return void toast.error("Upload a PDF, Excel, CSV or photo.");
      if (file.size > 15 * 1024 * 1024) return void toast.error("The file is larger than 15 MB.");
      const path = `settlements/${settlementId}/${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error } = await createClient().storage.from("dispatch").upload(path, file, { contentType: FILE_TYPES[ext], upsert: false });
      if (error) return void toast.error("The upload failed. Check your connection and try again.");
      const r = await attachSettlementFileAction({ settlement_id: settlementId, path, file_name: file.name });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add the parcels this payment covers</CardTitle>
            <CardDescription>
              Paste from Citypak&apos;s statement, one parcel per line: tracking number or reference, then the amount collected and the fee if
              there was one. Without an amount, what is still owed is used.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"D16950069\t1500\t20\nD16950070\t1500\nNOV26004"}
              className="font-mono text-sm"
              aria-label="Parcels to add"
            />
            <Button onClick={add} disabled={pending || !text.trim()}>
              {pending ? <Loader2Icon className="animate-spin" /> : <ListPlusIcon />} Add parcels
            </Button>
            {problems.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="mb-1 font-medium">Not added:</p>
                <ul className="space-y-0.5">
                  {problems.slice(0, 30).map((p, i) => (
                    <li key={i}>
                      <span className="font-mono">{p.code}</span> – {p.message}
                    </li>
                  ))}
                </ul>
                {problems.length > 30 && <p className="text-muted-foreground mt-1">and {problems.length - 30} more</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Total label="Parcels" value={String(lines.length)} />
        <Total label="Collected" value={formatLKR(collected)} />
        <Total label="Fees" value={formatLKR(fees)} />
        <Total
          label={diff === 0 ? "Matches amount received" : "Difference to amount received"}
          value={diff === 0 ? formatLKR(net) : `${diff > 0 ? "+" : "−"}${formatLKR(Math.abs(diff))}`}
          tone={lines.length === 0 ? undefined : diff === 0 ? "good" : "warn"}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Parcel</TableHead>
              <TableHead className="hidden md:table-cell">Round</TableHead>
              <TableHead className="hidden sm:table-cell">COD</TableHead>
              <TableHead>Collected</TableHead>
              <TableHead>Fee</TableHead>
              {draft && <TableHead className="w-24 pr-4" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center text-sm">
                  No parcels yet.
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => {
              const e = edits[l.id];
              return (
                <TableRow key={l.id}>
                  <TableCell className="pl-4">
                    <span className="font-mono text-sm">{l.reference}</span>
                    <span className="text-muted-foreground block text-xs">
                      {l.trackingNo ?? "—"} · {DELIVERY[l.deliveryState].label}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-sm md:table-cell">{l.roundName}</TableCell>
                  <TableCell className="hidden text-sm tabular-nums sm:table-cell">{formatLKR(l.codExpected)}</TableCell>
                  <TableCell>
                    {draft ? (
                      <Input
                        className="h-8 w-24 tabular-nums"
                        inputMode="decimal"
                        aria-label={`Collected for ${l.reference}`}
                        value={e?.collected ?? String(l.collected)}
                        onChange={(ev) => setEdits({ ...edits, [l.id]: { collected: ev.target.value.replace(/[^\d.]/g, ""), fee: e?.fee ?? String(l.fee) } })}
                      />
                    ) : (
                      <span className={cn("text-sm tabular-nums", l.collected !== l.codExpected && "text-amber-700 dark:text-warning")}>{formatLKR(l.collected)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {draft ? (
                      <Input
                        className="h-8 w-20 tabular-nums"
                        inputMode="decimal"
                        aria-label={`Fee for ${l.reference}`}
                        value={e?.fee ?? String(l.fee)}
                        onChange={(ev) => setEdits({ ...edits, [l.id]: { collected: e?.collected ?? String(l.collected), fee: ev.target.value.replace(/[^\d.]/g, "") } })}
                      />
                    ) : (
                      <span className="text-sm tabular-nums">{formatLKR(l.fee)}</span>
                    )}
                  </TableCell>
                  {draft && (
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1">
                        {e && (
                          <Button size="icon-sm" variant="ghost" onClick={() => saveLine(l)} disabled={pending} aria-label={`Save ${l.reference}`}>
                            <CheckIcon />
                          </Button>
                        )}
                        <Button size="icon-sm" variant="ghost" onClick={() => remove(l)} disabled={pending} aria-label={`Remove ${l.reference}`}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {draft && (
          <Button onClick={() => setConfirmOpen(true)} disabled={pending || lines.length === 0 || Object.keys(edits).length > 0}>
            <CheckIcon /> Confirm settlement
          </Button>
        )}
        {state !== "cancelled" && (
          <>
            <Button asChild variant="outline" disabled={pending}>
              <label className="cursor-pointer">
                <PaperclipIcon /> {fileId ? "Replace Citypak's report" : "Attach Citypak's report"}
                <input type="file" className="sr-only" accept=".pdf,.xlsx,.csv,image/*" onChange={(e) => attach(e.target.files?.[0] ?? null)} />
              </label>
            </Button>
            {(draft || canCancelConfirmed) && (
              <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={pending}>
                <XIcon /> Cancel settlement
              </Button>
            )}
          </>
        )}
        {fileId && (
          <Button asChild variant="link">
            <a href={`/admin/dispatch/files/${fileId}`} target="_blank" rel="noopener">
              Open attached report
            </a>
          </Button>
        )}
        {Object.keys(edits).length > 0 && <Badge variant="warning">Save the changed amounts first</Badge>}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm this settlement?</DialogTitle>
            <DialogDescription>
              {lines.length} parcels will count as paid. Confirmed settlements can only be cancelled by someone with the correct permission.
            </DialogDescription>
          </DialogHeader>
          {diff !== 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="dispute">
                The parcels add up to {formatLKR(net)} but {formatLKR(remitted)} was received. Explain the difference:
              </Label>
              <Input id="dispute" value={dispute} onChange={(e) => setDispute(e.target.value)} maxLength={300} placeholder="e.g. Citypak deducted a return charge" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
            <Button onClick={confirm} disabled={pending || (diff !== 0 && dispute.trim().length < 3)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this settlement?</DialogTitle>
            <DialogDescription>
              {state === "confirmed" ? "Its parcels will count as unpaid again. This is recorded." : "The draft and its parcel list are set aside."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-s">Reason{state === "confirmed" ? "" : " (optional)"}</Label>
            <Input id="cancel-s" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={pending || (state === "confirmed" && cancelReason.trim().length < 3)}>
              Cancel settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "good" && "border-success/50 bg-success/5",
        tone === "warn" && "border-warning/60 bg-warning/10",
      )}
    >
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
