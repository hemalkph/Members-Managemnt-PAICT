"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BanIcon, Loader2Icon, MoreHorizontalIcon, RepeatIcon, SearchIcon, TruckIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { replaceParcelAction, setDeliveryAction, voidParcelAction } from "@/lib/actions/dispatch-handover";
import { canVoid, DELIVERY, deliveryMove, needsReason, SETTABLE, type DeliveryState, type SettableState } from "@/lib/dispatch/delivery";
import { formatLKR } from "@/lib/format";

export type Recipient = {
  name: string;
  address_line1: string;
  address_line2: string;
  address_line3: string;
  city: string;
  phone1: string;
  phone2: string;
};

export type DeliveryRow = {
  id: string;
  reference: string;
  trackingNo: string | null;
  studentNo: string;
  recipient: Recipient;
  cod: number;
  deliveryState: DeliveryState;
  registrationState: string;
  inOpenHandover: boolean;
  replaced: boolean;
  itemIds: string[];
  note: string | null;
};

type Tute = { id: string; code: string; title: string };

export function DeliveryBoard({
  roundId,
  rows,
  tutes,
  canSet,
  canCorrect,
}: {
  roundId: string;
  rows: DeliveryRow[];
  tutes: Tute[];
  canSet: boolean;
  canCorrect: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"with_courier" | DeliveryState | "all">("with_courier");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<SettableState>("delivered");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [pending, startTransition] = useTransition();
  const [voiding, setVoiding] = useState<{ row: DeliveryRow; reason: string } | null>(null);
  const [resend, setResend] = useState<ResendState | null>(null);

  const live = rows.filter((r) => r.registrationState !== "voided");
  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter((r) => {
      if (filter === "all") {
        // everything, voided included
      } else if (r.registrationState === "voided") return false;
      else if (filter === "with_courier") {
        if (!["handed_over", "in_transit", "failed"].includes(r.deliveryState)) return false;
      } else if (r.deliveryState !== filter) return false;
      if (!q) return true;
      return [r.reference, r.trackingNo ?? "", r.studentNo, r.recipient.name.toUpperCase(), r.recipient.city.toUpperCase()].some((v) => v.includes(q));
    });
  }, [rows, filter, query]);

  const chosen = rows.filter((r) => selected.has(r.id));
  const moves = chosen.map((r) => deliveryMove(r.deliveryState, target));
  const correction = moves.includes("correction");
  const usable = chosen.filter((_, i) => moves[i] === "ok" || (moves[i] === "correction" && canCorrect));
  const reasonNeeded = needsReason(target, correction);
  const selectable = (r: DeliveryRow) => r.registrationState !== "voided" && r.deliveryState !== "awaiting_pickup";

  const apply = () =>
    startTransition(async () => {
      const r = await setDeliveryAction({ round_id: roundId, parcel_ids: usable.map((x) => x.id), state: target, reason, evidence });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setSelected(new Set());
      setReason("");
      setEvidence("");
      router.refresh();
    });

  const doVoid = () =>
    startTransition(async () => {
      if (!voiding) return;
      const r = await voidParcelAction({ parcel_id: voiding.row.id, round_id: roundId, reason: voiding.reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setVoiding(null);
      router.refresh();
    });

  const count = (s: DeliveryState) => live.filter((r) => r.deliveryState === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-full sm:w-60" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="with_courier">With the courier ({count("handed_over") + count("in_transit") + count("failed")})</SelectItem>
            {(Object.keys(DELIVERY) as DeliveryState[]).map((s) => (
              <SelectItem key={s} value={s}>
                {DELIVERY[s].label} ({count(s)})
              </SelectItem>
            ))}
            <SelectItem value="all">Everything, voided too ({rows.length})</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative sm:max-w-xs sm:flex-1">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference, tracking, name, city" className="pl-8" aria-label="Search parcels" />
        </div>
      </div>

      {canSet && chosen.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="target">Mark {chosen.length} selected as</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as SettableState)}>
                <SelectTrigger id="target" className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SETTABLE.map((s) => (
                    <SelectItem key={s} value={s}>
                      {DELIVERY[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:flex-1">
              <Label htmlFor="reason">Reason{reasonNeeded ? "" : " (optional)"}</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={target === "failed" ? "e.g. no one at home" : ""} />
            </div>
            <div className="space-y-1.5 sm:flex-1">
              <Label htmlFor="evidence">Where you saw it (optional)</Label>
              <Input id="evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} placeholder="e.g. Citypak portal, rider call" />
            </div>
            <Button onClick={apply} disabled={pending || usable.length === 0 || (reasonNeeded && reason.trim().length < 3)}>
              {pending ? <Loader2Icon className="animate-spin" /> : <TruckIcon />} Update {usable.length}
            </Button>
          </div>
          {usable.length < chosen.length && (
            <p className="text-muted-foreground text-xs">
              {chosen.length - usable.length} selected parcel(s) can&apos;t move to “{DELIVERY[target].label}”
              {correction && !canCorrect ? " – changing a delivered or returned parcel needs the correct permission" : ""}.
            </p>
          )}
          {correction && canCorrect && <p className="text-xs text-amber-700 dark:text-warning">This changes a final state and is recorded as a correction.</p>}
        </Card>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {canSet && (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all shown"
                    checked={shown.some(selectable) && shown.filter(selectable).every((r) => selected.has(r.id))}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(shown.filter(selectable).map((r) => r.id)) : new Set())}
                  />
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead className="hidden md:table-cell">Tracking</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="hidden sm:table-cell">COD</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              {canCorrect && <TableHead className="w-10 pr-4" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-6 text-center text-sm">
                  No parcels here.
                </TableCell>
              </TableRow>
            )}
            {shown.map((r) => (
              <TableRow key={r.id} className={r.registrationState === "voided" ? "opacity-60" : undefined}>
                {canSet && (
                  <TableCell className="pl-4">
                    <Checkbox
                      aria-label={`Select ${r.reference}`}
                      disabled={!selectable(r)}
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-sm">
                  {r.reference}
                  <span className="mt-1 block font-sans sm:hidden">
                    <StatusBadge row={r} />
                  </span>
                </TableCell>
                <TableCell className="hidden font-mono text-sm md:table-cell">{r.trackingNo ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  <span className="font-mono">{r.studentNo}</span>
                  <span className="text-muted-foreground block max-w-48 truncate text-xs">
                    {r.recipient.name} · {r.recipient.city}
                  </span>
                </TableCell>
                <TableCell className="hidden text-sm tabular-nums sm:table-cell">{formatLKR(r.cod)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge row={r} />
                  {r.note && <span className="text-muted-foreground mt-0.5 block max-w-40 truncate text-xs">{r.note}</span>}
                </TableCell>
                {canCorrect && (
                  <TableCell className="pr-4">
                    {canVoid({ delivery_state: r.deliveryState, registration_state: r.registrationState, inOpenHandover: r.inOpenHandover }) || (r.registrationState === "voided" && !r.replaced) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.reference}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setResend(resendFor(r))}>
                            <RepeatIcon /> Send again…
                          </DropdownMenuItem>
                          {r.registrationState !== "voided" && (
                            <DropdownMenuItem onSelect={() => setVoiding({ row: r, reason: "" })} className="text-destructive">
                              <BanIcon /> Void…
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voiding?.row.reference}?</DialogTitle>
            <DialogDescription>
              Void it with Citypak too if it was registered. The parcel stays in the history; it won&apos;t be packed, handed over or counted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Input id="void-reason" value={voiding?.reason ?? ""} onChange={(e) => voiding && setVoiding({ ...voiding, reason: e.target.value })} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={doVoid} disabled={pending || (voiding?.reason.trim().length ?? 0) < 3}>
              Void parcel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {resend && <ResendDialog roundId={roundId} state={resend} tutes={tutes} onClose={() => setResend(null)} />}
    </div>
  );
}

function StatusBadge({ row: r }: { row: DeliveryRow }) {
  if (r.registrationState === "voided") return <Badge variant="secondary">{r.replaced ? "Voided · sent again" : "Voided"}</Badge>;
  return <Badge variant={DELIVERY[r.deliveryState].variant}>{r.inOpenHandover ? "In open handover" : DELIVERY[r.deliveryState].label}</Badge>;
}

type ResendState = { row: DeliveryRow; reason: string; changeAddress: boolean; recipient: Recipient; cod: string; tutes: Set<string> };

const resendFor = (r: DeliveryRow): ResendState => ({
  row: r,
  reason: "",
  changeAddress: false,
  recipient: { ...r.recipient },
  cod: String(r.cod),
  tutes: new Set(r.itemIds),
});

function ResendDialog({ roundId, state, tutes, onClose }: { roundId: string; state: ResendState; tutes: Tute[]; onClose: () => void }) {
  const router = useRouter();
  const [s, setS] = useState(state);
  const [pending, startTransition] = useTransition();
  const field = (key: keyof Recipient, label: string, opts: { required?: boolean; inputMode?: "tel" } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`resend-${key}`}>
        {label}
        {opts.required ? "" : " (optional)"}
      </Label>
      <Input
        id={`resend-${key}`}
        value={s.recipient[key]}
        inputMode={opts.inputMode}
        onChange={(e) => setS({ ...s, recipient: { ...s.recipient, [key]: e.target.value } })}
      />
    </div>
  );
  const sameTutes = s.tutes.size === s.row.itemIds.length && s.row.itemIds.every((id) => s.tutes.has(id));
  const cod = Number(s.cod);

  const submit = () =>
    startTransition(async () => {
      const r = await replaceParcelAction({
        parcel_id: s.row.id,
        round_id: roundId,
        reason: s.reason,
        recipient: s.changeAddress ? s.recipient : null,
        cod_expected: Number.isFinite(cod) && cod !== s.row.cod ? cod : null,
        tute_ids: sameTutes ? null : [...s.tutes],
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {s.row.reference} again</DialogTitle>
          <DialogDescription>
            {s.row.registrationState === "voided" ? "" : "This voids the parcel and "}creates a new one with the next R reference. Register it with Citypak and import
            its tracking number, then pack it as usual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resend-reason">Reason</Label>
            <Input id="resend-reason" value={s.reason} onChange={(e) => setS({ ...s, reason: e.target.value })} maxLength={300} placeholder="e.g. returned – wrong address" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Tutes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {tutes.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={s.tutes.has(t.id)}
                    onCheckedChange={(v) => {
                      const n = new Set(s.tutes);
                      if (v === true) n.add(t.id);
                      else n.delete(t.id);
                      setS({ ...s, tutes: n });
                    }}
                  />
                  <span className="font-mono">{t.code}</span> <span className="text-muted-foreground truncate">{t.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resend-cod">COD amount (LKR)</Label>
            <Input id="resend-cod" inputMode="decimal" value={s.cod} onChange={(e) => setS({ ...s, cod: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            Change the address
            <Switch checked={s.changeAddress} onCheckedChange={(v) => setS({ ...s, changeAddress: v })} />
          </label>
          {s.changeAddress && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">{field("name", "Name", { required: true })}</div>
              <div className="sm:col-span-2">{field("address_line1", "Address line 1", { required: true })}</div>
              {field("address_line2", "Address line 2")}
              {field("address_line3", "Address line 3")}
              {field("city", "City", { required: true })}
              {field("phone1", "Phone", { required: true, inputMode: "tel" })}
              {field("phone2", "Second phone", { inputMode: "tel" })}
            </div>
          )}
          <p className="text-muted-foreground text-xs">The student&apos;s saved address is not changed – edit it on the Students page if it should stay.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || s.reason.trim().length < 3 || s.tutes.size === 0 || !Number.isFinite(cod)}>
            {pending ? <Loader2Icon className="animate-spin" /> : <RepeatIcon />} Create replacement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
