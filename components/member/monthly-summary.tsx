import { CheckCircle2Icon, ClockIcon, LayersIcon } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { monthLabel } from "@/lib/month";

export function MonthlySummary({
  month,
  total,
  approved,
  pending,
}: {
  month: string;
  total: number;
  approved: number;
  pending: number;
}) {
  const label = monthLabel(month, "short");
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard label="Submissions" value={total} icon={LayersIcon} hint={label} />
      <StatCard label="Approved" value={approved} icon={CheckCircle2Icon} tone="success" hint={label} delay={0.1} />
      <StatCard label="Pending" value={pending} icon={ClockIcon} tone="warning" hint={label} delay={0.2} />
    </div>
  );
}
