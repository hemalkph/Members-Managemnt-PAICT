"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2Icon, PrinterIcon, RotateCcwIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignParcelsAction, unpackParcelAction } from "@/lib/actions/dispatch-packing";
import { cn } from "@/lib/utils";

import { useT } from "@/components/dispatch/lang";
export type PackRow = {
  id: string;
  reference: string;
  trackingNo: string | null;
  studentNo: string;
  items: string;
  packState: string;
  onHold: boolean;
  registered: boolean;
  assignedTo: string | null;
  assignedName: string | null;
  packedName: string | null;
  verifiedName: string | null;
  rowVersion: number;
};

const NONE = "__none";
const SPLIT = "__split";

/** Who packs what, and a printable packing list (no addresses). */
export function PackingBoard({
  roundId,
  roundName,
  rows,
  packers,
  canUnpack,
}: {
  roundId: string;
  roundName: string;
  rows: PackRow[];
  packers: { id: string; name: string }[];
  canUnpack: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("all");
  const [target, setTarget] = useState<string>(packers[0]?.id ?? NONE);
  const [split, setSplit] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [unpack, setUnpack] = useState<{ row: PackRow; reason: string } | null>(null);

  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === "all"
          ? true
          : filter === "todo"
            ? r.packState === "planned"
            : filter === "unassigned"
              ? !r.assignedTo && r.packState === "planned"
              : filter === "hold"
                ? r.onHold
                : r.assignedTo === filter,
      ),
    [rows, filter],
  );
  const assignable = shown.filter((r) => r.packState === "planned");
  const chosen = rows.filter((r) => selected.has(r.id) && r.packState === "planned");

  const assign = () =>
    startTransition(async () => {
      const ids = chosen.map((r) => r.id);
      const packerIds = target === SPLIT ? [...split] : [target === NONE ? null : target];
      if (target === SPLIT && packerIds.length < 2)
        return void toast.error(t("Choose at least two packers to split between."));
      const result = await assignParcelsAction({ round_id: roundId, parcel_ids: ids, packer_ids: packerIds });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      setSelected(new Set());
      router.refresh();
    });

  const doUnpack = () =>
    startTransition(async () => {
      if (!unpack) return;
      const result = await unpackParcelAction({
        parcel_id: unpack.row.id,
        round_id: roundId,
        reason: unpack.reason,
        row_version: unpack.row.rowVersion,
      });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      setUnpack(null);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t("Show")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All parcels ({length})", { length: rows.length })}</SelectItem>
            <SelectItem value="todo">
              {t("Still to pack ({length})", { length: rows.filter((r) => r.packState === "planned").length })}
            </SelectItem>
            <SelectItem value="unassigned">{t("Not assigned")}</SelectItem>
            <SelectItem value="hold">
              {t("On hold ({length})", { length: rows.filter((r) => r.onHold).length })}
            </SelectItem>
            {packers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {t("{name}'s parcels", { name: p.name })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full sm:w-52" aria-label={t("Assign to")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {packers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {t("Assign to {name}", { name: p.name })}
                </SelectItem>
              ))}
              {packers.length > 1 && <SelectItem value={SPLIT}>{t("Split evenly between…")}</SelectItem>}
              <SelectItem value={NONE}>{t("Unassign")}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={assign} disabled={pending || chosen.length === 0}>
            {pending ? <Loader2Icon className="animate-spin" /> : <UsersIcon />}{" "}
            {t("Apply to {length}", { length: chosen.length })}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon /> {t("Print list")}
          </Button>
        </div>
      </div>
      {target === SPLIT && (
        <div className="flex flex-wrap gap-3 rounded-lg border p-3 text-sm print:hidden">
          {packers.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <Checkbox
                checked={split.has(p.id)}
                onCheckedChange={(v) =>
                  setSplit((s) => {
                    const n = new Set(s);
                    if (v === true) n.add(p.id);
                    else n.delete(p.id);
                    return n;
                  })
                }
              />
              {p.name}
            </label>
          ))}
          <span className="text-muted-foreground">{t("Parcels are split in reference order, in equal blocks.")}</span>
        </div>
      )}

      <h2 className="hidden text-lg font-semibold print:block">
        {t("Packing list – {roundName}", { roundName: roundName })}
      </h2>
      <Card className="py-0 print:border-0 print:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4 print:hidden">
                <Checkbox
                  aria-label={t("Select all shown")}
                  checked={assignable.length > 0 && assignable.every((r) => selected.has(r.id))}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(assignable.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>{t("Reference")}</TableHead>
              <TableHead>{t("No.")}</TableHead>
              <TableHead>{t("Tutes")}</TableHead>
              <TableHead>{t("Packer")}</TableHead>
              <TableHead>{t("State")}</TableHead>
              <TableHead className="hidden print:table-cell">✓</TableHead>
              {canUnpack && <TableHead className="w-10 pr-4 print:hidden" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id} className={cn(r.onHold && "bg-warning/10")}>
                <TableCell className="pl-4 print:hidden">
                  <Checkbox
                    aria-label={`Select ${r.reference}`}
                    disabled={r.packState !== "planned"}
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
                <TableCell className="font-mono text-sm">{r.reference}</TableCell>
                <TableCell className="font-mono text-sm">{r.studentNo}</TableCell>
                <TableCell className="font-mono text-sm">{r.items}</TableCell>
                <TableCell className="text-sm">{r.assignedName ?? "—"}</TableCell>
                <TableCell>
                  {r.onHold ? (
                    <Badge variant="warning">{t("On hold")}</Badge>
                  ) : r.packState === "verified" ? (
                    <Badge variant="success">{t("Verified")}</Badge>
                  ) : r.packState === "packed" ? (
                    <Badge variant="secondary">{t("Packed")}</Badge>
                  ) : !r.registered ? (
                    <Badge variant="outline">{t("No tracking")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("To pack")}</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden print:table-cell">☐</TableCell>
                {canUnpack && (
                  <TableCell className="pr-4 print:hidden">
                    {r.packState !== "planned" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Undo packing of {ref}", { ref: r.reference })}
                        onClick={() => setUnpack({ row: r, reason: "" })}
                      >
                        <RotateCcwIcon />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {unpack && (
        <Card className="space-y-2 p-4 print:hidden">
          <p className="text-sm font-medium">
            {t("Undo packing of {reference}?", { reference: unpack.row.reference })}
          </p>
          <Input
            value={unpack.reason}
            onChange={(e) => setUnpack({ ...unpack, reason: e.target.value })}
            placeholder={t("Reason, e.g. wrong tute packed")}
            maxLength={300}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setUnpack(null)}>
              {t("Cancel")}
            </Button>
            <Button onClick={doUnpack} disabled={pending || unpack.reason.trim().length < 3}>
              {t("Undo packing")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
