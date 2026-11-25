import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatLKR } from "@/lib/core/format";
import type { MoneyClassCell, MoneyMonth } from "@/lib/money/build";
import { cn } from "@/lib/utils";

const SOURCE_HINT: Record<MoneyClassCell["source"], string> = {
  amounts: "From the amounts on the paid list",
  fee: "Paid students (without Free enrollment) × the class fee",
  no_fee: "This class has no fee yet",
  no_count: "No paid list or count this month",
};

function IncomeCell({ cell }: { cell: MoneyClassCell | undefined }) {
  if (!cell || cell.source === "no_count") return <span className="text-muted-foreground">–</span>;
  if (cell.source === "no_fee") {
    return (
      <span className="text-xs font-medium text-amber-700 dark:text-warning" title={SOURCE_HINT.no_fee}>
        Set a fee
      </span>
    );
  }
  return (
    <span className="tabular-nums" title={`${SOURCE_HINT[cell.source]}${cell.paid !== null ? ` · ${cell.paid} paid` : ""}`}>
      {formatLKR(cell.income ?? 0)}
    </span>
  );
}

/** Six months side by side: income per class, then the totals and costs. */
export function MoneyTable({ months }: { months: MoneyMonth[] }) {
  const classes = new Map<string, { name: string; batch: string }>();
  for (const m of months) for (const c of m.classes) if (!classes.has(c.classId)) classes.set(c.classId, c);

  const stickyCell = "sticky left-0 z-10 bg-card";
  const totalRow = (label: string, value: (m: MoneyMonth) => React.ReactNode, className?: string) => (
    <TableRow className={className}>
      <TableCell className={cn(stickyCell, "font-medium")}>{label}</TableCell>
      {months.map((m) => (
        <TableCell key={m.key} className="text-right tabular-nums">
          {value(m)}
        </TableCell>
      ))}
    </TableRow>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className={cn(stickyCell, "min-w-40")}>Class</TableHead>
          {months.map((m) => (
            <TableHead key={m.key} className="min-w-28 text-right">
              {m.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...classes].map(([id, c]) => (
          <TableRow key={id}>
            <TableCell className={stickyCell}>
              <p className="font-medium">{c.name}</p>
              <p className="text-muted-foreground text-xs">{c.batch}</p>
            </TableCell>
            {months.map((m) => (
              <TableCell key={m.key} className="text-right">
                <IncomeCell cell={m.classes.find((x) => x.classId === id)} />
              </TableCell>
            ))}
          </TableRow>
        ))}
        {totalRow("Total income", (m) => <span className="font-semibold">{formatLKR(m.income)}</span>, "bg-muted/40")}
        {totalRow("Staff pay", (m) => (
          <span>
            {formatLKR(m.staff)}
            {!m.staffClosed && m.staff > 0 && <span className="text-muted-foreground block text-[11px]">estimate</span>}
          </span>
        ))}
        {totalRow("Printing", (m) => formatLKR(m.printing))}
        {totalRow("Postage", (m) => formatLKR(m.postage))}
        {totalRow(
          "Profit",
          (m) => <span className={cn("font-semibold", m.profit < 0 && "text-destructive")}>{formatLKR(m.profit)}</span>,
          "bg-muted/40",
        )}
      </TableBody>
    </Table>
  );
}
