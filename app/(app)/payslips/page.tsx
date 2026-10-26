import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheckIcon, CircleDashedIcon, DownloadIcon, FileTextIcon, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import CountUp from "@/components/reactbits/count-up";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { MEMBERS_CAN_SEE_PAYSLIPS } from "@/lib/config";
import { formatDate, formatLKR } from "@/lib/format";
import { dateToMonthKey, monthLabel } from "@/lib/month";
import { normalisePayout } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My payslips" };

export default async function MyPayslipsPage() {
  const profile = await requireUser();

  if (!MEMBERS_CAN_SEE_PAYSLIPS) {
    return (
      <div className="space-y-6">
        <PageHeader title="My payslips" />
        <EmptyState icon={FileTextIcon} title="Payslips are not shared" description="Ask a main admin for your payslip." />
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select("*")
    .eq("user_id", profile.id)
    .order("month", { ascending: false })
    .limit(36);
  const payslips = (data ?? []).map(normalisePayout);

  const paid = payslips.filter((p) => p.status === "paid");
  const paidTotal = paid.reduce((s, p) => s + p.total_amount, 0);
  const year = new Date().getFullYear().toString();
  const thisYear = paid.filter((p) => p.month.startsWith(year)).reduce((s, p) => s + p.total_amount, 0);
  const waiting = payslips.filter((p) => p.status === "unpaid" && p.total_amount > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="My payslips" description="A payslip is ready when a main admin closes the month." />

      {payslips.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label={`Paid in ${year}`} value={thisYear} prefix="Rs." icon={WalletIcon} tone="success" />
          <StatCard
            label="Waiting for payment"
            value={waiting.reduce((s, p) => s + p.total_amount, 0)}
            prefix="Rs."
            icon={CircleDashedIcon}
            tone="warning"
            hint={`${waiting.length} payslip${waiting.length === 1 ? "" : "s"}`}
            delay={0.1}
          />
          <StatCard
            label="Paid in total"
            value={paidTotal}
            prefix="Rs."
            icon={BadgeCheckIcon}
            hint={`${paid.length} month${paid.length === 1 ? "" : "s"}`}
            delay={0.2}
          />
        </div>
      )}

      {payslips.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="No payslips yet"
          description="Your first payslip appears here after the month you worked in is closed."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {payslips.map((p, i) => {
            const key = dateToMonthKey(p.month);
            return (
              <SpotlightCard key={p.id} className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{monthLabel(key)}</p>
                    <p className="text-muted-foreground font-mono text-xs">{p.payslip_no}</p>
                  </div>
                  {p.status === "paid" ? (
                    <Badge variant="success">
                      <BadgeCheckIcon /> Paid
                    </Badge>
                  ) : p.total_amount > 0 ? (
                    <Badge variant="warning">
                      <CircleDashedIcon /> Not paid yet
                    </Badge>
                  ) : (
                    <Badge variant="outline">Nothing to pay</Badge>
                  )}
                </div>
                <div>
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">
                    <span className="text-muted-foreground mr-0.5 text-base font-medium">Rs.</span>
                    <CountUp key={p.total_amount} to={p.total_amount} delay={Math.min(i, 6) * 0.05} />
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {p.salary_amount > 0 && <>Salary {formatLKR(p.salary_amount)} · </>}
                    Work {formatLKR(p.work_amount)}
                    {p.status === "paid" && <> · paid {formatDate(p.paid_on)}</>}
                  </p>
                </div>
                <div className="mt-auto flex gap-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/payslips/${p.id}`}>
                      <FileTextIcon /> View
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="flex-1">
                    <a href={`/payslips/${p.id}/pdf`} download>
                      <DownloadIcon /> PDF
                    </a>
                  </Button>
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
