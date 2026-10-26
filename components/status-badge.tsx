import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SubmissionStatus } from "@/lib/database.types";

const CONFIG = {
  pending: { label: "Pending", variant: "warning", Icon: ClockIcon },
  approved: { label: "Approved", variant: "success", Icon: CheckCircle2Icon },
  rejected: { label: "Rejected", variant: "destructive", Icon: XCircleIcon },
} as const;

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const { label, variant, Icon } = CONFIG[status];
  return (
    <Badge variant={variant}>
      <Icon /> {label}
    </Badge>
  );
}
