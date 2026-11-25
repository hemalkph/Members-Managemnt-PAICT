import type { Metadata } from "next";
import { AlertTriangleIcon, BanknoteIcon, ReceiptIcon, TrendingUpIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ClassFeesCard } from "@/components/money/class-fees-card";
import { MoneyTable } from "@/components/money/money-table";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMainAdmin } from "@/lib/auth";
import { dateToMonthKey, isMonthKey, monthLabel, todayISO } from "@/lib/core/month";
import { getMoneyPage } from "@/lib/money/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Income & profit" };

export default async function MoneyPage({ searchParams }: PageProps<"/admin/money">) {
  await requireMainAdmin();
  // Class fees follow calendar months (pay months run 11th–10th), so default to this calendar month.
  const thisMonth = dateToMonthKey(todayISO());
  const param = (await searchParams).month;
  const month = typeof param === "string" && isMonthKey(param) ? param : thisMonth;
  const supabase = await createClient();
  const { months, fees, error } = await getMoneyPage(supabase, month);
  const current = months.at(-1);

  const header = (
    <PageHeader
      title="Income & profit"
      description="Income from class fees against staff pay, printing and postage. For main admins only."
      actions={<MonthSelect value={month} calendar />}
    />
  );

  if (error || !current) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={AlertTriangleIcon}
          title="Couldn't load income and costs"
          description={error ?? "Please try again."}
        />
      </div>
    );
  }

  const costs = current.staff + current.printing + current.postage;
  const short = monthLabel(month, "short");

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Income in ${short}`}
          value={current.income}
          prefix="Rs."
          icon={BanknoteIcon}
          tone="success"
          hint="Estimate: paid students × class fee"
        />
        <StatCard
          label={`Costs in ${short}`}
          value={costs}
          prefix="Rs."
          icon={ReceiptIcon}
          hint={current.staffClosed ? "Staff pay, printing, postage" : "Staff pay is an estimate"}
          delay={0.1}
        />
        <StatCard
          label={`Profit in ${short}`}
          value={current.profit}
          prefix="Rs."
          icon={TrendingUpIcon}
          tone={current.profit < 0 ? "warning" : "primary"}
          delay={0.2}
        />
        {current.missingFees > 0 && (
          <StatCard
            label="Classes without a fee"
            value={current.missingFees}
            icon={AlertTriangleIcon}
            tone="warning"
            hint="Their income is left out"
            delay={0.3}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Last 6 months</CardTitle>
            <CardDescription>
              Income is worked out from each class&apos;s paid count and fee, or from the amounts on the paid list when it
              has them. Staff pay follows pay months (11th to the 10th).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyTable months={months} />
          </CardContent>
        </Card>
        <ClassFeesCard fees={fees} thisMonth={thisMonth} />
      </div>
    </div>
  );
}
