"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CircleDashedIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { markPaidAction } from "@/lib/actions/payments";
import { formatDate, formatLKR, maskAccountNumber } from "@/lib/format";
import { MarkPaidDialog } from "./mark-paid-dialog";

export type PayoutRow = {
  id: string;
  payslipNo: string;
  userId: string | null;
  name: string;
  bankName: string | null;
  last4: string | null;
  /** The member changed their bank details after the month was closed. */
  bankChanged: boolean;
  salary: number;
  work: number;
  total: number;
  items: number;
  status: "paid" | "unpaid";
  paidOn: string | null;
  reference: string | null;
};

export function PayoutsTable({ rows, today }: { rows: PayoutRow[]; today: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogIds, setDialogIds] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const unpaid = rows.filter((r) => r.status === "unpaid");
  const selectedUnpaid = unpaid.filter((r) => selected.has(r.id));
  const allChecked = unpaid.length > 0 && selectedUnpaid.length === unpaid.length;
  const someChecked = selectedUnpaid.length > 0 && !allChecked;
  const dialogRows = rows.filter((r) => dialogIds?.includes(r.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const markUnpaid = (row: PayoutRow) =>
    startTransition(async () => {
      const result = await markPaidAction({ ids: [row.id], paid: false, paid_on: "", reference: "" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.name} marked as not paid`);
      router.refresh();
    });

  const totals = rows.reduce(
    (t, r) => ({ salary: t.salary + r.salary, work: t.work + r.work, total: t.total + r.total }),
    { salary: 0, work: 0, total: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {rows.length} payslip{rows.length === 1 ? "" : "s"} · {unpaid.length} not paid yet
        </p>
        <div className="flex flex-wrap gap-2">
          {selectedUnpaid.length > 0 ? (
            <Button variant="success" onClick={() => setDialogIds(selectedUnpaid.map((r) => r.id))}>
              <BadgeCheckIcon /> Mark {selectedUnpaid.length} as paid
            </Button>
          ) : (
            unpaid.length > 0 && (
              <Button variant="outline" onClick={() => setDialogIds(unpaid.map((r) => r.id))}>
                <BadgeCheckIcon /> Mark all as paid
              </Button>
            )
          )}
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select all not paid"
                  disabled={unpaid.length === 0}
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(unpaid.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Member</TableHead>
              <TableHead className="hidden lg:table-cell">Bank</TableHead>
              <TableHead className="hidden text-right md:table-cell">Salary</TableHead>
              <TableHead className="hidden text-right md:table-cell">Work</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-10 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    disabled={r.status === "paid"}
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) => toggle(r.id, v === true)}
                  />
                </TableCell>
                <TableCell className="max-w-[150px] sm:max-w-none">
                  <Link href={`/payslips/${r.id}`} className="block truncate font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-muted-foreground font-mono text-xs">{r.payslipNo}</p>
                  <div className="mt-1 sm:hidden">
                    <PaidBadge row={r} />
                  </div>
                </TableCell>
                <TableCell className="hidden text-xs lg:table-cell">
                  {r.bankName ? (
                    <div className="flex items-start gap-1.5">
                      <div className="text-muted-foreground">
                        {r.bankName}
                        <br />
                        <span className="font-mono">{maskAccountNumber(r.last4)}</span>
                      </div>
                      {r.bankChanged && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangleIcon
                              className="text-amber-600 dark:text-warning mt-0.5 size-4"
                              aria-label="Bank details changed"
                            />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-56">
                            Bank details were changed after this month was closed. Check the activity log before paying.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ) : (
                    <Badge variant="warning">No bank details</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {r.salary > 0 ? formatLKR(r.salary) : "—"}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {r.work > 0 ? formatLKR(r.work) : "—"}
                  {r.items > 0 && <span className="text-muted-foreground block text-xs">{r.items} items</span>}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatLKR(r.total)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PaidBadge row={r} />
                </TableCell>
                <TableCell className="pr-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name}`} disabled={pending}>
                        {pending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem asChild>
                        <Link href={`/payslips/${r.id}`}>
                          <FileTextIcon /> View payslip
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={`/payslips/${r.id}/pdf`} download>
                          <DownloadIcon /> Download PDF
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {r.status === "unpaid" ? (
                        <DropdownMenuItem onSelect={() => setDialogIds([r.id])}>
                          <BadgeCheckIcon /> Mark as paid
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => markUnpaid(r)}>
                          <Undo2Icon /> Mark as not paid
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4" />
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatLKR(totals.salary)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatLKR(totals.work)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatLKR(totals.total)}</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="pr-4" />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <MarkPaidDialog
        rows={dialogRows}
        today={today}
        open={dialogIds !== null}
        onOpenChange={(open) => !open && setDialogIds(null)}
        onDone={() => {
          setSelected(new Set());
          setDialogIds(null);
        }}
      />
    </div>
  );
}

function PaidBadge({ row }: { row: PayoutRow }) {
  if (row.status === "paid") {
    return (
      <div>
        <Badge variant="success">
          <BadgeCheckIcon /> Paid
        </Badge>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {formatDate(row.paidOn)}
          {row.reference && <> · {row.reference}</>}
        </p>
      </div>
    );
  }
  if (row.total === 0) return <Badge variant="outline">Nothing to pay</Badge>;
  return (
    <Badge variant="warning">
      <CircleDashedIcon /> Not paid
    </Badge>
  );
}
