import { CheckCircle2Icon, ClockIcon, LayersIcon, WalletIcon } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { formatLKR } from "@/lib/format";
import { monthLabel } from "@/lib/month";

export function MonthlySummary({
  month,
  total,
  approved,
  pending,
  earnedApproved = 0,
  earnedPending = 0,
  showMoney = false,
}: {
  month: string;
  total: number;
  approved: number;
  pending: number;
  earnedApproved?: number;
  earnedPending?: number;
  showMoney?: boolean;
}) {
  const label = monthLabel(month, "short");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Submissions" value={total} icon={LayersIcon} hint={label} />
        <StatCard label="Approved" value={approved} icon={CheckCircle2Icon} tone="success" hint={label} delay={0.1} />
        <StatCard label="Pending" value={pending} icon={ClockIcon} tone="warning" hint={label} delay={0.2} />
      </div>
      {showMoney && (earnedApproved > 0 || earnedPending > 0) && (
        <div className="from-primary/10 to-chart-2/10 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border bg-gradient-to-r px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <WalletIcon className="text-primary size-4" /> Earnings for {label}
          </span>
          <span>
            Approved <span className="font-semibold tabular-nums">{formatLKR(earnedApproved)}</span>
          </span>
          {earnedPending > 0 && (
            <span className="text-muted-foreground">+ {formatLKR(earnedPending)} waiting for review</span>
          )}
        </div>
      )}
    </div>
  );
}
