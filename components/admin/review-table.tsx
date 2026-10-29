"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheckIcon, FileStackIcon, Loader2Icon, PaperclipIcon } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reviewSubmissionsAction } from "@/lib/actions/admin";
import { formatDate, formatLKR } from "@/lib/format";
import { ReviewDialog, type ReviewRow } from "./review-dialog";

export function ReviewTable({ rows, readOnly = false }: { rows: ReviewRow[]; readOnly?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingRows = rows.filter((r) => r.status === "pending");
  const selectedPending = pendingRows.filter((r) => selected.has(r.id));
  const allChecked = pendingRows.length > 0 && selectedPending.length === pendingRows.length;
  const someChecked = selectedPending.length > 0 && !allChecked;
  const openRow = rows.find((r) => r.id === openId) ?? null;
  const paperRows = pendingRows.filter((r) => r.fromPaper);
  const selectedValue = selectedPending.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulkApprove = () =>
    startTransition(async () => {
      const result = await reviewSubmissionsAction({
        ids: selectedPending.map((r) => r.id),
        decision: "approved",
        comment: "",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {rows.length} submission{rows.length === 1 ? "" : "s"} · {pendingRows.length} pending
          {!readOnly && selectedPending.length === 0 && pendingRows.length > 1 && " · tick several to approve them together"}
        </p>
        <div className={readOnly ? "hidden" : "flex flex-wrap items-center gap-2"}>
          {paperRows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(paperRows.map((r) => r.id)))}
              title="Page counts logged from finished type setting / conversion stages"
            >
              <FileStackIcon /> Select paper page counts ({paperRows.length})
            </Button>
          )}
          {selectedPending.length > 0 && (
            <Button variant="success" onClick={bulkApprove} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <CheckCheckIcon />}
              Approve {selectedPending.length} selected
              {selectedValue > 0 && <span className="font-normal opacity-90">· {formatLKR(selectedValue)}</span>}
            </Button>
          )}
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select all pending"
                  disabled={readOnly || pendingRows.length === 0}
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(pendingRows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Submission</TableHead>
              <TableHead className="hidden md:table-cell">Member</TableHead>
              <TableHead className="hidden lg:table-cell">Role</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
              <TableHead className="pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                data-state={selected.has(r.id) ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => setOpenId(r.id)}
              >
                <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select ${r.title}`}
                    disabled={readOnly || r.status !== "pending"}
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) => toggle(r.id, v === true)}
                  />
                </TableCell>
                <TableCell className="max-w-[130px] sm:max-w-[280px]">
                  <button
                    type="button"
                    className="block w-full truncate text-left font-medium hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenId(r.id);
                    }}
                  >
                    {r.title}
                  </button>
                  <p className="text-muted-foreground flex items-center gap-1 truncate text-xs md:hidden">
                    {r.memberName} · {r.roleName}
                  </p>
                  {r.attachments.length + r.links.length > 0 && (
                    <p className="text-muted-foreground hidden items-center gap-1 text-xs md:flex">
                      <PaperclipIcon className="size-3" /> {r.attachments.length + r.links.length}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <p className="max-w-[160px] truncate">{r.memberName}</p>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <p className="max-w-[180px] truncate">{r.roleName}</p>
                  <p className="text-muted-foreground max-w-[180px] truncate text-xs">{r.sectionName}</p>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {r.quantity}
                  {r.unit && (
                    <span className="text-muted-foreground block text-xs font-normal">
                      {r.unit}
                      {r.quantity === 1 ? "" : "s"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{formatDate(r.date_done)}</TableCell>
                <TableCell className="pr-4">
                  <StatusBadge status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ReviewDialog
        key={openRow ? `${openRow.id}-${openRow.status}` : "none"}
        row={openRow}
        open={openRow !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        readOnly={readOnly}
      />
    </div>
  );
}
